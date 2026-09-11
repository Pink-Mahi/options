/**
 * Backtest API — runs a repeating options income strategy over historical prices.
 *
 * Premiums are MODELED with Black-Scholes from trailing realized volatility,
 * not historical option quotes. The response always carries that caveat.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getHistoricalPrices, getQuote } from "@/features/market-data/service";
import { runBacktest, type BacktestStrategy } from "@/lib/calculations/backtester";
import { isThetaDataConfigured, prefetchEODChains, fetchContractDailyRows, type ThetaDataEODQuote } from "@/features/market-data/thetadata";

export const dynamic = "force-dynamic";

const ALLOWED_STRATEGIES: BacktestStrategy[] = ["COVERED_CALL", "CASH_SECURED_PUT", "WHEEL"];
const ALLOWED_RANGES = ["1y", "3y", "5y", "10y", "max"] as const;
type HistRange = (typeof ALLOWED_RANGES)[number];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });

  const rawStrategy = String(body.strategy ?? "").toUpperCase();
  if (!(ALLOWED_STRATEGIES as string[]).includes(rawStrategy)) {
    return NextResponse.json(
      { error: `strategy must be one of ${ALLOWED_STRATEGIES.join(", ")}` },
      { status: 400 },
    );
  }
  const strategy = rawStrategy as BacktestStrategy;

  const requestedRange = String(body.range ?? "3y").toLowerCase();
  const range: HistRange = (ALLOWED_RANGES as readonly string[]).includes(requestedRange)
      ? (requestedRange as HistRange)
      : "3y";

  // NDJSON stream: one JSON event per line. Progress events flow to the UI
  // while the backtest runs; the final line carries the full result payload.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Client disconnected mid-run — keep computing, writes are best-effort.
        }
      };

      try {
        send({ type: "progress", message: "Loading price history…", stage: "fetch" });

        const [hist, quote, spyHist] = await Promise.all([
          getHistoricalPrices({ symbol, range }),
          getQuote({ symbol }),
          getHistoricalPrices({ symbol: "SPY", range }).catch(() => null),
        ]);

        const spot = quote.data.price;
        const contracts = Number(body.contracts) > 0 ? Number(body.contracts) : 1;
        const shares = strategy === "CASH_SECURED_PUT" ? 0 : contracts * 100;
        const startingCapital =
          Number(body.startingCapital) > 0
            ? Number(body.startingCapital)
            : Math.max(spot * contracts * 100, 1);

        const dteTarget = Number(body.dteTarget) > 0 ? Number(body.dteTarget) : 45;
        const tradingDaysPerCycle = Math.round(dteTarget * 252 / 365);

        // Pre-fetch real EOD option chains from ThetaData if terminal is configured.
        let realData: Map<string, ThetaDataEODQuote[]> | undefined;
        if (isThetaDataConfigured()) {
          const datesToFetch = hist.data.points.slice(30).map((p) => p.date);
          if (datesToFetch.length > 0) {
            send({
              type: "progress",
              message: `Loading EOD option chains (${datesToFetch.length} dates) — checking DB cache first…`,
              stage: "prefetch",
              done: 0,
              total: datesToFetch.length,
            });
            console.log(`[backtest] Pre-fetching ${datesToFetch.length} EOD chains (DB cache + ThetaData)...`);
            try {
              realData = await prefetchEODChains(symbol, datesToFetch, (doneNum, totalNum, cachedCount) => {
                send({
                  type: "progress",
                  message: cachedCount > 0
                    ? `Loading EOD chains — ${doneNum}/${totalNum} (${cachedCount} from cache)`
                    : `Loading EOD option chains — ${doneNum}/${totalNum} dates processed`,
                  stage: "prefetch",
                  done: doneNum,
                  total: totalNum,
                });
              });
              const withData = Array.from(realData.values()).filter((q) => q.length > 0).length;
              console.log(`[backtest] EOD chains ready: ${withData}/${datesToFetch.length} dates with real quotes`);
              send({
                type: "progress",
                message: `EOD chains ready: ${withData}/${datesToFetch.length} dates with real quotes`,
                stage: "prefetch",
                done: datesToFetch.length,
                total: datesToFetch.length,
              });
              if (withData === 0) {
                console.warn("[backtest] ThetaData terminal is not reachable or returned no data — all cycles will use BS model. Check container logs for terminal startup.");
                realData = undefined;
              }
            } catch (err) {
              console.warn("[backtest] ThetaData prefetch failed, using BS model:", err);
              send({ type: "progress", message: "ThetaData prefetch failed — falling back to BS model", stage: "prefetch" });
            }
          }
        }

        // GTC touch simulation setup
        // When disableGtcTouch is true (from optimizer click), use the already-fetched
        // EOD chain data for touch checks instead of making extra per-contract API calls.
        // This ensures the full backtest matches the optimizer's results exactly.
        const disableGtcTouch = body.disableGtcTouch === true;
        let getDailyRows: Parameters<typeof runBacktest>[1]["getDailyRows"];
        let touchFetchCount = 0;
        if (realData && disableGtcTouch) {
          // Build getDailyRows from already-fetched EOD data — instant, no API calls
          const contractIndex = new Map<string, Map<string, ThetaDataEODQuote>>();
          for (const quotes of realData.values()) {
            for (const q of quotes) {
              const key = `${q.right}|${q.strike}|${q.expiration}`;
              let byDate = contractIndex.get(key);
              if (!byDate) {
                byDate = new Map();
                contractIndex.set(key, byDate);
              }
              byDate.set(q.date, q);
            }
          }
          getDailyRows = async (c) => {
            const key = `${c.optionType}|${c.strike}|${c.expiration}`;
            return contractIndex.get(key) ?? new Map();
          };
        } else if (realData && !disableGtcTouch) {
          const rowsCache = new Map<string, Map<string, ThetaDataEODQuote>>();
          const reqDelayMs = Number(process.env.THETADATA_REQ_DELAY_MS ?? 200);
          getDailyRows = async (c) => {
            const key = `${c.optionType}|${c.strike}|${c.expiration}`;
            const cached = rowsCache.get(key);
            if (cached) return cached;
            touchFetchCount++;
            if (reqDelayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, reqDelayMs));
            }
            try {
              const rows = await fetchContractDailyRows(
                symbol,
                c.expiration,
                c.strike,
                c.optionType,
                c.from,
                c.to,
              );
              rowsCache.set(key, rows);
              return rows;
            } catch {
              const empty = new Map<string, ThetaDataEODQuote>();
              rowsCache.set(key, empty);
              return empty;
            }
          };
        }

        const totalCyclesEstimate = Math.max(1, Math.floor((hist.data.points.length - 30) / tradingDaysPerCycle));
        send({
          type: "progress",
          message: `Running backtest — ~${totalCyclesEstimate} cycles over ${hist.data.points.length} trading days…`,
          stage: "backtest",
          done: 0,
          total: totalCyclesEstimate,
        });

        const result = await runBacktest(
          hist.data.points,
          {
            strategy,
            symbol,
            deltaTarget: Number(body.deltaTarget) > 0 ? Number(body.deltaTarget) : 0.3,
            dteTarget,
            contracts,
            riskFreeRate: Number(body.riskFreeRate) > 0 ? Number(body.riskFreeRate) : 0.05,
            startingCapital,
            shares,
            strikeInterval: spot >= 200 ? 5 : spot >= 50 ? 2.5 : 1,
            fillAssumption: body.fillAssumption === "mid" ? "mid" : "bid",
            dividendYield: Number(body.dividendYield) >= 0 ? Number(body.dividendYield) : undefined,
            ivRiskPremium: Number(body.ivRiskPremium) > 0 ? Number(body.ivRiskPremium) : 1.15,
            ivSkewEnabled: body.ivSkewEnabled !== false,
            termStructureEnabled: body.termStructureEnabled !== false,
            neverSellCallBelowCostBasis: body.neverSellCallBelowCostBasis === true,
            minCallPremiumYieldPct:
              Number(body.minCallPremiumYieldPct) > 0 ? Number(body.minCallPremiumYieldPct) : undefined,
            minPutPremiumYieldPct:
              Number(body.minPutPremiumYieldPct) > 0 ? Number(body.minPutPremiumYieldPct) : undefined,
            averageDownWithPremium: body.averageDownWithPremium === true,
            buyBackPct:
              Number(body.buyBackPct) > 0 && Number(body.buyBackPct) < 1
                ? Number(body.buyBackPct)
                : undefined,
            rollOnAssignment: body.rollOnAssignment === true,
            realData,
            getDailyRows,
            // Phase 1 accuracy features (opt-in via body params, default off
            // for backward compat with existing UI; the optimizer enables them)
            commissionPerContract:
              Number(body.commissionPerContract) >= 0 ? Number(body.commissionPerContract) : undefined,
            assignmentFee:
              Number(body.assignmentFee) >= 0 ? Number(body.assignmentFee) : undefined,
            slippagePerShare:
              Number(body.slippagePerShare) >= 0 ? Number(body.slippagePerShare) : undefined,
            cashInterestEnabled: body.cashInterestEnabled === true,
            snapExpiration: body.snapExpiration === true,
            hasWeeklies: body.hasWeeklies !== false,
          },
          spyHist?.data.points,
        );

        if (getDailyRows) {
          console.log(
            `[backtest] GTC touch simulation: ${touchFetchCount} contract histories fetched for ${result.touchCycles} cycles (${result.touchExitCount} exit + ${result.touchEntryCount} entry intraday fills)`,
          );
        }

        send({
          type: "progress",
          message: `Backtest complete — ${result.totalCycles} cycles`,
          stage: "done",
          done: result.totalCycles,
          total: result.totalCycles,
        });

        send({
          type: "result",
          ...result,
          startingCapital,
          underlyingPrice: spot,
          dataSourceSummary: {
            realDataCycles: result.realDataCycles,
            bsModelCycles: result.bsModelCycles,
            totalCycles: result.totalCycles,
            usingRealData: result.realDataCycles > 0,
          },
          modelCaveat: isThetaDataConfigured()
            ? result.realDataCycles > 0
              ? `Option premiums use real historical bid/ask from ThetaData for ${result.realDataCycles} of ${result.totalCycles} cycles. The remaining ${result.bsModelCycles} cycles use Black-Scholes (IV risk premium + skew + term structure) as fallback. Results are more realistic but still not an achievable track record.` +
                (result.touchCycles > 0
                  ? ` GTC orders in ${result.touchCycles} cycles were simulated against daily highs/lows (intraday touches): ${result.touchExitCount} buy-backs and ${result.touchEntryCount} entries filled on a touch.`
                  : "")
              : "ThetaData terminal is configured but no real data was available for the requested dates. All cycles use Black-Scholes model. Check that the terminal is running and the date range is within your subscription tier."
            : "Option premiums are modeled with Black-Scholes using trailing 30-day realized volatility with IV risk premium (1.15x), equity skew, and term structure. Not historical option quotes. Real fills would differ, and this is not an achievable track record.",
        });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
