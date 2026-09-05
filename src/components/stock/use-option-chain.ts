"use client";

import { useCallback, useEffect, useState } from "react";
import type { CorporateEvents, OptionChain } from "@/lib/types";

interface ChainResponse {
  chain: OptionChain;
  events: CorporateEvents | null;
  fetchedAt: string;
  fromCache: boolean;
  dataQuality: "realtime" | "delayed" | "unknown";
}

export function useOptionChain(symbol: string, expiration: string) {
  const [data, setData] = useState<ChainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchChain = useCallback(async () => {
    if (!symbol || !expiration) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stock/${encodeURIComponent(symbol)}/chain?expiration=${encodeURIComponent(expiration)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, expiration]);

  useEffect(() => {
    fetchChain();
  }, [fetchChain]);

  return { data, error, loading, refetch: fetchChain };
}
