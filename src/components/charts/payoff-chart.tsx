"use client";

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
import type { PayoffSeries } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

interface PayoffChartProps {
  series: PayoffSeries;
  showStockOnly?: boolean;
  showOption?: boolean;
  height?: number;
}

export function PayoffChart({ series, showStockOnly = true, showOption = false, height = 320 }: PayoffChartProps) {
  const data = series.points.map((p) => ({
    price: p.stockPrice,
    Combined: Math.round(p.combinedPnl),
    Stock: Math.round(p.stockOnlyPnl),
    Option: Math.round(p.optionPnl),
  }));

  const maxAbs = Math.max(
    ...data.map((d) => Math.max(Math.abs(d.Combined), Math.abs(d.Stock ?? 0), Math.abs(d.Option ?? 0))),
    1,
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="price"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v) => `$${v}`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
        />
        <YAxis
          domain={[-maxAbs, maxAbs]}
          tickFormatter={(v) => `$${v}`}
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
          labelFormatter={(v) => `Stock @ $${v}`}
          formatter={(value: number, name: string) => [formatCurrency(value), name]}
        />
        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
        <ReferenceLine
          x={series.currentPrice}
          stroke="hsl(var(--accent-foreground))"
          strokeDasharray="4 4"
          label={{ value: `Current $${series.currentPrice}`, fontSize: 10, position: "top" }}
        />
        <ReferenceLine
          x={series.strike}
          stroke="hsl(var(--profit))"
          strokeDasharray="4 4"
          label={{ value: `Strike $${series.strike}`, fontSize: 10, position: "top" }}
        />
        <ReferenceLine
          x={series.breakEven}
          stroke="hsl(var(--loss))"
          strokeDasharray="2 2"
          label={{ value: `BE $${series.breakEven}`, fontSize: 10, position: "bottom" }}
        />
        <Line type="monotone" dataKey="Combined" stroke="hsl(var(--profit))" strokeWidth={2} dot={false} name="Covered Call" />
        {showStockOnly && (
          <Line type="monotone" dataKey="Stock" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Stock Only" />
        )}
        {showOption && (
          <Line type="monotone" dataKey="Option" stroke="hsl(var(--ring))" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="Option Only" />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
