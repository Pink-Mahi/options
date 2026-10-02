"use client";

import { useEffect, useMemo, useState } from "react";
import type { Portfolio, Quote, StockLot } from "@/lib/types";
import type { StockData } from "@/features/options/stock-data";
import { StockHeader } from "./stock-header";
import { StockTabs } from "./stock-tabs";

/**
 * Polls the quote endpoint and injects the fresh quote into the StockData
 * object passed to the header and all tabs — every component that reads
 * `data.quote` (spot price, bid/ask, ext-hours) updates live without a page
 * refresh. Polls fast while the market is open, slowly when closed, and
 * pauses entirely while the tab is hidden.
 */
const POLL_OPEN_MS = 10_000;
const POLL_CLOSED_MS = 60_000;

export function StockLive({
  data,
  position,
  portfolio,
}: {
  data: StockData;
  position: StockLot | null;
  portfolio: Portfolio | null;
}) {
  const [quote, setQuote] = useState<Quote>(data.quote);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function schedule() {
      if (stopped) return;
      const delay = quote.marketSession === "closed" ? POLL_CLOSED_MS : POLL_OPEN_MS;
      timer = setTimeout(poll, delay);
    }

    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/stock/${quote.symbol}/quote`, { cache: "no-store" });
          if (res.ok) {
            const body = (await res.json()) as { quote?: Quote };
            if (body.quote) setQuote((prev) => ({ ...prev, ...body.quote! }));
          }
        } catch {
          // Ignore transient fetch errors — keep polling.
        }
      }
      schedule();
    }

    function onVisibility() {
      // Poll immediately when the tab becomes visible again.
      if (document.visibilityState === "visible") poll();
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [quote.symbol, quote.marketSession]);

  const liveData = useMemo(() => ({ ...data, quote }), [data, quote]);

  return (
    <>
      <StockHeader data={liveData} position={position} />
      <StockTabs data={liveData} portfolio={portfolio} />
    </>
  );
}
