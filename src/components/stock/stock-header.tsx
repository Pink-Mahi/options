"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatPercent, formatTimestamp, formatCompact } from "@/lib/utils";
import type { StockData } from "@/features/options/stock-data";
import type { MarketSession, StockLot } from "@/lib/types";

const SESSION_LABELS: Record<MarketSession, { label: string; color: string }> = {
  pre: { label: "Pre-Market", color: "bg-blue-500/15 text-blue-700 border-blue-500/30" },
  regular: { label: "Regular Hours", color: "bg-green-500/15 text-green-700 border-green-500/30" },
  post: { label: "After Hours", color: "bg-purple-500/15 text-purple-700 border-purple-500/30" },
  closed: { label: "Market Closed", color: "bg-muted text-muted-foreground border-border" },
};

export function StockHeader({ data, position }: { data: StockData; position: StockLot | null }) {
  const { quote } = data;
  const up = (quote.change ?? 0) >= 0;
  const sessionInfo = SESSION_LABELS[quote.marketSession];
  const hasExtHours = quote.extendedHoursPrice != null;
  const extUp = (quote.extendedHoursChange ?? 0) >= 0;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{quote.symbol}</h1>
            <span className="text-sm text-muted-foreground">{quote.companyName}</span>
            {position && <Badge variant="secondary">Owned: {position.shares} sh</Badge>}
            <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", sessionInfo.color)}>
              {sessionInfo.label}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-bold tabular">{formatCurrency(quote.price)}</span>
            <span className={cn("flex items-center gap-1 text-sm font-medium tabular", up ? "text-profit" : "text-loss")}>
              {up ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              {formatCurrency(quote.change)}
              ({formatPercent(quote.changePercent)})
            </span>
          </div>
          {hasExtHours && (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">Ext. Hours:</span>
              <span className="text-sm font-bold tabular">{formatCurrency(quote.extendedHoursPrice)}</span>
              <span className={cn("flex items-center gap-0.5 text-xs font-medium tabular", extUp ? "text-profit" : "text-loss")}>
                {extUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {formatCurrency(quote.extendedHoursChange)}
                ({formatPercent(quote.extendedHoursChangePercent)})
              </span>
            </div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            Quote: {formatTimestamp(quote.timestamp)} · {quote.dataQuality === "realtime" ? "Real-time" : quote.dataQuality === "delayed" ? "Delayed" : "Unknown"}
            {data.errors.length > 0 && <span className="ml-2 text-amber-600">· partial data</span>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <QuoteStat label="Bid" value={formatCurrency(quote.bid)} />
          <QuoteStat label="Ask" value={formatCurrency(quote.ask)} />
          <QuoteStat label="Prev Close" value={formatCurrency(quote.previousClose)} />
          <QuoteStat label="Day High" value={formatCurrency(quote.dayHigh)} />
          <QuoteStat label="Day Low" value={formatCurrency(quote.dayLow)} />
          <QuoteStat label="Volume" value={formatCompact(quote.volume)} />
          <QuoteStat label="52w High" value={formatCurrency(quote.week52High ?? data.historicalReturns.high52Week)} />
          <QuoteStat label="52w Low" value={formatCurrency(quote.week52Low ?? data.historicalReturns.low52Week)} />
          <QuoteStat label="Avg Vol" value={formatCompact(quote.averageVolume)} />
          <QuoteStat label="Vol (1y ann.)" value={formatPercent(data.historicalReturns.annualizedVolatility)} />
        </div>
      </div>
    </div>
  );
}

function QuoteStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="tabular font-medium">{value}</div>
    </div>
  );
}
