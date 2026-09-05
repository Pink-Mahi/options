"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoricalPricePoint } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export function PriceHistoryChart({ points, height = 260 }: { points: HistoricalPricePoint[]; height?: number }) {
  const data = points.map((p) => ({ date: p.date, close: p.adjustedClose }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--profit))" stopOpacity={0.3} />
            <stop offset="100%" stopColor="hsl(var(--profit))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          minTickGap={40}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            color: "hsl(var(--popover-foreground))",
          }}
          labelFormatter={(v) => v}
          formatter={(value: number) => [formatCurrency(value), "Close"]}
        />
        <Area type="monotone" dataKey="close" stroke="hsl(var(--profit))" strokeWidth={1.5} fill="url(#priceFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
