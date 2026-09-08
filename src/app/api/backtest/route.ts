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
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
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
    // The backtester looks up real bid/ask by date, falling back to BS model
    // for any dates not in the map.
    let realData: Map<string, ThetaDataEODQuote[]> | undefined;
    if (isThetaDataConfigured()) {
      const cycleDates: string[] = [];
      for (let i = 30; i < hist.data.points.length; i += tradingDaysPerCycle) {
        const p = hist.data.points[i];
        if (p) cycleDates.push(p.date);
      }
      // Limit to 60 cycles to avoid excessive API calls (free tier: 30 req/min)
      const datesToFetch = cycleDates.slice(0, 60);
      if (datesToFetch.length > 0) {
        console.log(`[backtest] Pre-fetching ${datesToFetch.length} EOD chains from ThetaData...`);
        try {
          realData = await prefetchEODChains(symbol, datesToFetch);
          const withData = Array.from(realData.values()).filter((q) => q.length > 0).length;
          console.log(`[backtest] ThetaData prefetch complete: ${withData}/${datesToFetch.length} dates returned real quotes`);
          if (withData === 0) {
            console.warn("[backtest] ThetaData terminal is not reachable or returned no data — all cycles will use BS model. Check container logs for terminal startup.");
            realData = undefined;
          }
        } catch (err) {
          console.warn("[backtest] ThetaData prefetch failed, using BS model:", err);
        }
      }
    }

    // GTC touch simulation: the backtester asks for daily rows (bid/ask/
    // high/low/close) of each contract it sells, and fills resting orders
    // the day the price trades through the limit. Cached per contract and
    // rate-limited like the chain prefetch.
    let getDailyRows: Parameters<typeof runBacktest>[1]["getDailyRows"];
    let touchFetchCount = 0;
    if (realData) {
      const rowsCache = new Map<string, Map<string, ThetaDataEODQuote>>();
      const reqDelayMs = Number(process.env.THETADATA_REQ_DELAY_MS ?? 2100);
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
      },
      spyHist?.data.points,
    );

    if (getDailyRows) {
      console.log(
        `[backtest] GTC touch simulation: ${touchFetchCount} contract histories fetched for ${result.touchCycles} cycles (${result.touchExitCount} exit + ${result.touchEntryCount} entry intraday fills)`,
      );
    }

    return NextResponse.json({
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
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
