"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, Input, Label } from "@/components/ui";
import { Activity, Database } from "lucide-react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
} from "recharts";
import type { StockData } from "@/features/options/stock-data";

interface IntradayCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: "pre" | "regular" | "post";
}

export function PriceActionTab({ data }: { data: StockData }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [candles, setCandles] = useState<IntradayCandle[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to last 30 days
  function defaultDates() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  }

  async function fetchIntraday() {
    if (!startDate || !endDate) {
      setError("Please select start and end dates");
      return;
    }
    setLoading(true);
    setError(null);
    setProgress("Starting…");
    setCandles([]);
    try {
      const res = await fetch("/api/stock/intraday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: data.symbol, startDate, endDate }),
      });
      if (!res.ok || !res.body) throw new Error("Failed to fetch intraday data");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as { type: string; message?: string; error?: string; candles?: IntradayCandle[]; candleCount?: number };
          if (evt.type === "progress") {
            setProgress(evt.message ?? "Working…");
          } else if (evt.type === "result") {
            setCandles(evt.candles ?? []);
            setProgress(`${evt.candleCount ?? 0} candles loaded`);
          } else if (evt.type === "error") {
            throw new Error(evt.error ?? "Fetch failed");
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Aggregate candles by day for daily summary
  const dailySummary = candles.length > 0
    ? Object.entries(
        candles.reduce<Record<string, IntradayCandle[]>>((acc, c) => {
          const day = c.timestamp.slice(0, 10);
          if (!acc[day]) acc[day] = [];
          acc[day].push(c);
          return acc;
        }, {}),
      ).map(([day, dayCandles]) => {
        const regular = dayCandles.filter((c) => c.session === "regular");
        const pre = dayCandles.filter((c) => c.session === "pre");
        const post = dayCandles.filter((c) => c.session === "post");
        const allHigh = Math.max(...dayCandles.map((c) => c.high));
        const allLow = Math.min(...dayCandles.map((c) => c.low));
        const regularVol = regular.reduce((s, c) => s + c.volume, 0);
        const preVol = pre.reduce((s, c) => s + c.volume, 0);
        const postVol = post.reduce((s, c) => s + c.volume, 0);
        const openPrice = dayCandles[0]?.open ?? 0;
        const closePrice = dayCandles[dayCandles.length - 1]?.close ?? 0;
        return {
          date: day,
          open: openPrice,
          close: closePrice,
          high: allHigh,
          low: allLow,
          regularVol,
          preVol,
          postVol,
          totalVol: regularVol + preVol + postVol,
          change: ((closePrice - openPrice) / openPrice) * 100,
          range: ((allHigh - allLow) / openPrice) * 100,
          preMove: pre.length > 0
            ? ((pre[pre.length - 1]!.close - pre[0]!.open) / pre[0]!.open) * 100
            : 0,
        };
      }).sort((a, b) => a.date.localeCompare(b.date))
    : [];

  // Session statistics
  const sessionStats = candles.length > 0
    ? (() => {
        const pre = candles.filter((c) => c.session === "pre");
        const regular = candles.filter((c) => c.session === "regular");
        const post = candles.filter((c) => c.session === "post");
        const preVol = pre.reduce((s, c) => s + c.volume, 0);
        const regVol = regular.reduce((s, c) => s + c.volume, 0);
        const postVol = post.reduce((s, c) => s + c.volume, 0);
        const totalVol = preVol + regVol + postVol;
        return {
          preCount: pre.length,
          regCount: regular.length,
          postCount: post.length,
          preVolPct: totalVol > 0 ? (preVol / totalVol) * 100 : 0,
          regVolPct: totalVol > 0 ? (regVol / totalVol) * 100 : 0,
          postVolPct: totalVol > 0 ? (postVol / totalVol) * 100 : 0,
        };
      })()
    : null;

  // Last trading day candles for intraday chart
  const lastDay = dailySummary[dailySummary.length - 1]?.date;
  const lastDayCandles = lastDay
    ? candles.filter((c) => c.timestamp.slice(0, 10) === lastDay)
    : [];

  const lastDayChartData = lastDayCandles.map((c) => ({
    time: c.timestamp.slice(11, 16),
    close: c.close,
    volume: c.volume,
    session: c.session,
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Intraday Price Action
          </CardTitle>
          <CardDescription>
            Fetch 1-minute candles with premarket (4:00-9:30 ET) and after-hours (16:00-20:00 ET) from ThetaData.
            Data is cached in the database — subsequent loads are instant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
              />
            </div>
            <Button onClick={fetchIntraday} disabled={loading} className="gap-1.5">
              <Database className="h-4 w-4" />
              {loading ? "Fetching…" : "Fetch Intraday Data"}
            </Button>
            <Button variant="outline" onClick={defaultDates} size="sm">
              Last 30 days
            </Button>
            {progress && (
              <span className="self-center text-xs text-muted-foreground">{progress}</span>
            )}
          </div>

          {loading && (
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Activity className="h-5 w-5 shrink-0 animate-pulse text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{progress}</p>
                <p className="text-sm text-muted-foreground">
                  Fetching 1-minute candles from ThetaData — includes premarket and after-hours sessions.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {candles.length > 0 && sessionStats && (
        <>
          {/* Session Statistics */}
          <Card>
            <CardHeader>
              <CardTitle>Session Breakdown</CardTitle>
              <CardDescription>Volume distribution across trading sessions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Total Candles</p>
                  <p className="text-2xl font-bold">{candles.length.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Trading Days</p>
                  <p className="text-2xl font-bold">{dailySummary.length}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Regular Session Vol</p>
                  <p className="text-2xl font-bold">{sessionStats.regVolPct.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Extended Hours Vol</p>
                  <p className="text-2xl font-bold">{(sessionStats.preVolPct + sessionStats.postVolPct).toFixed(1)}%</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <div className="flex-1 rounded-md bg-blue-500/10 p-2 text-center">
                  <p className="text-xs text-muted-foreground">Premarket</p>
                  <p className="font-medium">{sessionStats.preVolPct.toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground">{sessionStats.preCount} bars</p>
                </div>
                <div className="flex-1 rounded-md bg-green-500/10 p-2 text-center">
                  <p className="text-xs text-muted-foreground">Regular</p>
                  <p className="font-medium">{sessionStats.regVolPct.toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground">{sessionStats.regCount} bars</p>
                </div>
                <div className="flex-1 rounded-md bg-purple-500/10 p-2 text-center">
                  <p className="text-xs text-muted-foreground">After Hours</p>
                  <p className="font-medium">{sessionStats.postVolPct.toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground">{sessionStats.postCount} bars</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Last Day Intraday Chart */}
          {lastDayChartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Intraday — {lastDay}</CardTitle>
                <CardDescription>1-minute close price and volume for the most recent trading day</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={lastDayChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="time" className="text-xs" interval={30} />
                    <YAxis yAxisId="price" className="text-xs" domain={["auto", "auto"]} />
                    <YAxis yAxisId="vol" orientation="right" className="text-xs" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                    />
                    <ReferenceLine x="09:30" yAxisId="price" stroke="#3b82f6" strokeDasharray="3 3" label={{ value: "Open", position: "top", fill: "#3b82f6", fontSize: 10 }} />
                    <ReferenceLine x="16:00" yAxisId="price" stroke="#a855f7" strokeDasharray="3 3" label={{ value: "Close", position: "top", fill: "#a855f7", fontSize: 10 }} />
                    <Line yAxisId="price" type="monotone" dataKey="close" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
                    <Bar yAxisId="vol" dataKey="volume" fill="hsl(var(--muted))" opacity={0.3} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Daily Summary Chart */}
          {dailySummary.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Daily Price & Volume</CardTitle>
                <CardDescription>Close price and total volume per trading day</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={dailySummary}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis yAxisId="price" className="text-xs" domain={["auto", "auto"]} />
                    <YAxis yAxisId="vol" orientation="right" className="text-xs" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Line yAxisId="price" type="monotone" dataKey="close" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Bar yAxisId="vol" dataKey="totalVol" fill="hsl(var(--muted))" opacity={0.3} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Daily Stats Table */}
          {dailySummary.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Daily Statistics</CardTitle>
                <CardDescription>Per-day breakdown including premarket move and daily range</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2 pr-4 text-right">Open</th>
                        <th className="pb-2 pr-4 text-right">Close</th>
                        <th className="pb-2 pr-4 text-right">Change</th>
                        <th className="pb-2 pr-4 text-right">Range</th>
                        <th className="pb-2 pr-4 text-right">Pre-Move</th>
                        <th className="pb-2 pr-4 text-right">Reg Vol</th>
                        <th className="pb-2 pr-4 text-right">Ext Vol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailySummary.slice(-20).reverse().map((d) => (
                        <tr key={d.date} className="border-b">
                          <td className="py-1.5 pr-4">{d.date}</td>
                          <td className="py-1.5 pr-4 text-right">${d.open.toFixed(2)}</td>
                          <td className="py-1.5 pr-4 text-right">${d.close.toFixed(2)}</td>
                          <td className={`py-1.5 pr-4 text-right ${d.change >= 0 ? "text-profit" : "text-loss"}`}>
                            {d.change >= 0 ? "+" : ""}{d.change.toFixed(2)}%
                          </td>
                          <td className="py-1.5 pr-4 text-right">{d.range.toFixed(2)}%</td>
                          <td className={`py-1.5 pr-4 text-right ${d.preMove >= 0 ? "text-profit" : "text-loss"}`}>
                            {d.preMove >= 0 ? "+" : ""}{d.preMove.toFixed(2)}%
                          </td>
                          <td className="py-1.5 pr-4 text-right">{(d.regularVol / 1e6).toFixed(1)}M</td>
                          <td className="py-1.5 pr-4 text-right">{((d.preVol + d.postVol) / 1e6).toFixed(1)}M</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {candles.length === 0 && !loading && !error && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Activity className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p>Select a date range and fetch intraday data to see 1-minute candle charts.</p>
            <p className="text-xs mt-1">Data includes premarket (4:00-9:30 ET) and after-hours (16:00-20:00 ET).</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
