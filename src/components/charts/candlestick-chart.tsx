"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface CandleData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface ChartRow extends CandleData {
  overlay: number | null;
  isUp: boolean;
}

/**
 * Candlestick chart using recharts with custom Bar shape.
 *
 * Renders OHLC candlesticks with optional volume bars and an overlay line
 * (e.g. option price) on the same y-axis.
 */
export function CandlestickChart({
  data,
  height = 400,
  showVolume = true,
  overlayData,
  overlayLabel,
}: {
  data: CandleData[];
  height?: number;
  showVolume?: boolean;
  overlayData?: { date: string; value: number }[];
  overlayLabel?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
        No data to display
      </div>
    );
  }

  const overlayMap = new Map(overlayData?.map((d) => [d.date, d.value]) ?? []);

  // Calculate y-axis domain from all prices + overlay
  const allPrices = data.flatMap((d) => [d.high, d.low]);
  if (overlayData) {
    allPrices.push(...overlayData.map((d) => d.value));
  }
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const padding = Math.max(0.01, (maxPrice - minPrice) * 0.05);
  const yDomain: [number, number] = [minPrice - padding, maxPrice + padding];

  const chartData: ChartRow[] = data.map((d) => ({
    ...d,
    overlay: overlayMap.get(d.date) ?? null,
    isUp: d.close >= d.open,
  }));

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function renderCandle(props: any) {
    const { x, y, width, height, payload } = props;
    if (!payload || payload.high == null || payload.low == null) return <g />;

    const centerX = x + width / 2;
    const candleWidth = Math.max(2, width * 0.6);
    const isUp = payload.close >= payload.open;
    const color = isUp
      ? "hsl(var(--profit, 142 71% 45%))"
      : "hsl(var(--loss, 0 72% 51%))";

    // Derive pixel scale from the Bar's known positions:
    // y = pixel position of payload.high
    // y + height = pixel position of yDomain[0] (axis baseline)
    const chartBottom = y + height;
    const axisMin = yDomain[0];
    const denom = payload.high - axisMin;
    const scale = (val: number) =>
      denom > 0
        ? chartBottom - ((val - axisMin) / denom) * (chartBottom - y)
        : y;

    const highY = y;
    const lowY = scale(payload.low);
    const openY = scale(payload.open);
    const closeY = scale(payload.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(closeY - openY));

    return (
      <g>
        <line x1={centerX} x2={centerX} y1={highY} y2={lowY} stroke={color} strokeWidth={1} />
        <rect
          x={centerX - candleWidth / 2}
          y={bodyTop}
          width={candleWidth}
          height={bodyHeight}
          fill={color}
          opacity={isUp ? 0.7 : 0.9}
          stroke={color}
          strokeWidth={0.5}
        />
      </g>
    );
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 10, right: 50, bottom: 0, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-xs"
          interval={Math.max(1, Math.floor(chartData.length / 10))}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis
          yAxisId="price"
          className="text-xs"
          domain={yDomain}
          tickFormatter={(v: number) => `$${v.toFixed(v < 10 ? 2 : 0)}`}
        />
        {showVolume && (
          <YAxis
            yAxisId="vol"
            orientation="right"
            className="text-xs"
            tickFormatter={(v: number) => `${(v / 1e6).toFixed(0)}M`}
          />
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
          }}
          formatter={(value: unknown, name: string) => {
            if (typeof value === "number") {
              return [`$${value.toFixed(2)}`, name];
            }
            return [String(value), name];
          }}
          labelFormatter={(label: string) => `Date: ${label}`}
        />

        {/* Candlesticks */}
        <Bar
          yAxisId="price"
          dataKey="high"
          shape={renderCandle}
          isAnimationActive={false}
        />

        {/* Overlay line (e.g. option price) */}
        {overlayData && overlayData.length > 0 && (
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="overlay"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            name={overlayLabel ?? "Overlay"}
            connectNulls
          />
        )}

        {/* Volume bars */}
        {showVolume && (
          <Bar
            yAxisId="vol"
            dataKey="volume"
            fill="hsl(var(--muted))"
            opacity={0.2}
            name="Volume"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
