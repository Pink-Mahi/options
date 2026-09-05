"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency, formatPercent } from "@/lib/utils";
import type { OptionChain } from "@/lib/types";

/**
 * IV skew chart: plots implied volatility by strike for both calls and puts.
 * Reveals the volatility smile/skew — essential for identifying whether OTM
 * puts are rich (crash protection demand) or calls are rich (takeover/dividend
 * expectations).
 */
export function IVSkewChart({ chain, height = 280 }: { chain: OptionChain; height?: number }) {
  const data = useMemo(() => {
    const spot = chain.underlyingPrice;
    const calls = chain.calls
      .filter((c) => c.impliedVolatility != null && c.impliedVolatility > 0)
      .map((c) => ({ strike: c.strike, callIV: c.impliedVolatility ?? 0, otmPct: (c.strike - spot) / spot }));
    const puts = chain.puts
      .filter((p) => p.impliedVolatility != null && p.impliedVolatility > 0)
      .map((p) => ({ strike: p.strike, putIV: p.impliedVolatility ?? 0 }));
    // Merge by strike.
    const map = new Map<number, { strike: number; callIV: number | null; putIV: number | null }>();
    for (const c of calls) {
      const existing = map.get(c.strike) ?? { strike: c.strike, callIV: null, putIV: null };
      existing.callIV = c.callIV;
      map.set(c.strike, existing);
    }
    for (const p of puts) {
      const existing = map.get(p.strike) ?? { strike: p.strike, callIV: null, putIV: null };
      existing.putIV = p.putIV;
      map.set(p.strike, existing);
    }
    return Array.from(map.values()).sort((a, b) => a.strike - b.strike);
  }, [chain]);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">IV skew</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No IV data available for this expiration.</p></CardContent>
      </Card>
    );
  }

  const spot = chain.underlyingPrice;
  const ivs = data.flatMap((d) => [d.callIV, d.putIV]).filter((v): v is number => v != null && v > 0);
  const minIV = Math.min(...ivs) * 0.9;
  const maxIV = Math.max(...ivs) * 1.1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">IV skew — implied volatility by strike</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="strike"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => `$${v}`}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
            />
            <YAxis
              domain={[minIV, maxIV]}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
                color: "hsl(var(--popover-foreground))",
              }}
              labelFormatter={(v) => `Strike $${v}`}
              formatter={(value: number, name: string) => [formatPercent(value), name === "callIV" ? "Call IV" : "Put IV"]}
            />
            <ReferenceLine
              x={spot}
              stroke="hsl(var(--primary))"
              strokeDasharray="4 4"
              label={{ value: `Spot $${spot.toFixed(0)}`, fontSize: 10, position: "top" }}
            />
            <Line type="monotone" dataKey="callIV" stroke="hsl(var(--profit))" strokeWidth={2} dot={false} name="Call IV" connectNulls />
            <Line type="monotone" dataKey="putIV" stroke="hsl(var(--loss))" strokeWidth={2} dot={false} name="Put IV" connectNulls />
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-muted-foreground">
          The smile/skew shape reveals whether the market prices downside risk (left side elevated) or upside
          risk (right side elevated) more expensively. Flat = symmetric expectations.
        </p>
      </CardContent>
    </Card>
  );
}
