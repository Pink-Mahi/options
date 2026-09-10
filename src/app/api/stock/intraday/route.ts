import { NextResponse } from "next/server";
import {
  isThetaDataConfigured,
  fetchIntradayCandles,
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
        const startDate = String(body.startDate ?? "");
        const endDate = String(body.endDate ?? "");

        if (!symbol || !startDate || !endDate) {
          send({ type: "error", error: "symbol, startDate, and endDate are required" });
          controller.close();
          return;
        }

        if (!isThetaDataConfigured()) {
          send({ type: "error", error: "ThetaData terminal is not configured." });
          controller.close();
          return;
        }

        send({
          type: "progress",
          message: `Fetching 1-minute candles for ${symbol} (${startDate} to ${endDate})…`,
          stage: "fetch",
          done: 0,
          total: 1,
        });

        const candles = await fetchIntradayCandles(
          symbol,
          startDate,
          endDate,
          (done, total, cachedCount) => {
            send({
              type: "progress",
              message: cachedCount > 0
                ? `Fetching intraday data — ${done}/${total} dates (${cachedCount} from cache)`
                : `Fetching intraday data — ${done}/${total} dates`,
              stage: "fetch",
              done,
              total,
            });
          },
        );

        send({
          type: "result",
          symbol,
          startDate,
          endDate,
          candleCount: candles.length,
          candles: candles.slice(-5000), // Last 5000 candles to avoid huge payloads
          message: `Loaded ${candles.length} candles for ${symbol}`,
          warning: candles.length > 0 && (candles[0]?.timestamp?.length ?? 0) <= 10
            ? "Using daily EOD data (free tier). Intraday 1-minute candles require a ThetaData 'value' subscription."
            : undefined,
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
