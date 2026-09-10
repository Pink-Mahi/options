import { NextResponse } from "next/server";
import { getHistoricalPrices } from "@/features/market-data/service";
import {
  isThetaDataConfigured,
  prefetchEODChains,
} from "@/features/market-data/thetadata";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Client disconnected
        }
      };

      try {
        const body = await req.json();
        const symbol = String(body.symbol ?? "").toUpperCase();
        const range = String(body.range ?? "3y") as "1m" | "3m" | "6m" | "1y" | "3y" | "5y" | "10y" | "max";

        if (!symbol) {
          send({ type: "error", error: "Symbol is required" });
          controller.close();
          return;
        }

        send({ type: "progress", message: `Loading price history for ${symbol}…`, stage: "fetch", done: 0, total: 1 });

        const hist = await getHistoricalPrices({ symbol, range });
        const dates = hist.data.points.slice(30).map((p) => p.date);

        if (dates.length === 0) {
          send({ type: "error", error: "No historical price data available" });
          controller.close();
          return;
        }

        if (!isThetaDataConfigured()) {
          send({ type: "error", error: "ThetaData terminal is not configured. Set THETADATA_EMAIL and THETADATA_PASSWORD." });
          controller.close();
          return;
        }

        send({
          type: "progress",
          message: `Pre-fetching ${dates.length} EOD option chains for ${symbol} (${range})…`,
          stage: "prefetch",
          done: 0,
          total: dates.length,
        });

        const result = await prefetchEODChains(symbol, dates, (done, total, cachedCount) => {
          send({
            type: "progress",
            message: cachedCount > 0
              ? `Pre-warming cache — ${done}/${total} (${cachedCount} from cache)`
              : `Pre-warming cache — ${done}/${total} dates fetched`,
            stage: "prefetch",
            done,
            total,
          });
        });

        const withData = Array.from(result.values()).filter((q) => q.length > 0).length;
        send({
          type: "result",
          message: `Cache pre-warmed: ${withData}/${dates.length} dates with real EOD data for ${symbol}`,
          datesWith: withData,
          datesTotal: dates.length,
        });
      } catch (err) {
        send({ type: "error", error: (err as Error).message });
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
