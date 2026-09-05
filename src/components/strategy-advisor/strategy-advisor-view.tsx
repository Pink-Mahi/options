"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Home, AlertTriangle, Info, CheckCircle2, XCircle, HelpCircle, TrendingUp, TrendingDown } from "lucide-react";
import { cn, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

interface CallRecommendation {
  contract: { strike: number; expiration: string; daysToExpiration: number; bid: number | null; ask: number | null };
  dte: number;
  strike: number;
  premiumPerShare: number;
  premiumYield: number;
  annualizedYield: number;
  assignmentProbability: number | null;
  expireWorthlessProbability: number | null;
  upsideIfAssigned: number;
  totalReturnIfAssigned: number;
  strategy: "income_keep" | "income_sell" | "balanced";
  explanation: string;
  isBestPick: boolean;
}

interface DTEComparison {
  dte: number;
  expiration: string;
  bestCall: CallRecommendation | null;
  callsAnalyzed: number;
  avgPremiumYield: number;
  avgAssignmentProb: number;
}

interface StockQualityScore {
  total: number;
  grade: string;
  components: { trend: number; stability: number; growth: number; drawdownRisk: number; technicalBias: number };
  explanation: string;
  strengths: string[];
  concerns: string[];
}

interface StrategyAdvisorResponse {
  symbol: string;
  currentPrice: number;
  quality: StockQualityScore;
  verdict: "strong_buy" | "buy" | "caution" | "avoid";
  verdictExplanation: string;
  recommendedDTE: { dte: number; reason: string };
  dteComparisons: DTEComparison[];
  bestPick: CallRecommendation | null;
  summary: string[];
  warnings: string[];
  dataSource?: string;
  dataRange?: string;
  barsAnalyzed?: number;
}

const verdictConfig = {
  strong_buy: { label: "STRONG BUY", color: "profit", icon: CheckCircle2, border: "border-green-500/30 bg-green-500/5" },
  buy: { label: "BUY", color: "profit", icon: CheckCircle2, border: "border-green-500/20 bg-green-500/5" },
  caution: { label: "CAUTION", color: "warning", icon: HelpCircle, border: "border-amber-500/30 bg-amber-500/5" },
  avoid: { label: "AVOID", color: "loss", icon: XCircle, border: "border-red-500/30 bg-red-500/5" },
};

const gradeColors: Record<string, string> = {
  A: "profit", B: "profit", C: "warning", D: "loss", F: "loss",
};

const strategyLabels: Record<string, { label: string; hint: string; color: "profit" | "warning" | "loss" }> = {
  income_keep: { label: "Keep the Stock", hint: "Strike is far enough above the price that you'll likely keep your shares", color: "profit" },
  income_sell: { label: "Willing to Sell", hint: "Strike is near the price — higher income but more likely to be assigned", color: "warning" },
  balanced: { label: "Balanced", hint: "Moderate strike — some chance of assignment, some chance of keeping shares", color: "profit" },
};

export function StrategyAdvisorView() {
  const [symbol, setSymbol] = useState("");
  const [contracts, setContracts] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StrategyAdvisorResponse | null>(null);

  async function analyze() {
    if (!symbol.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/strategy-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: symbol.toUpperCase().trim(), contracts: Number(contracts) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Analysis failed");
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!data && !loading && !error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="h-5 w-5" />
            Strategy Advisor: Should I Buy This House and Rent It Out?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              How this works
            </p>
            <p className="text-sm text-muted-foreground">
              Enter a stock ticker. We&apos;ll analyze it like a house you&apos;re thinking of buying:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4">
              <li><strong>1. Is the neighborhood good?</strong> — We score the stock&apos;s quality (trend, stability, growth, drawdown risk, technical signals) from A to F.</li>
              <li><strong>2. How much rent can you collect?</strong> — We scan all available call options and find the best one to sell for income.</li>
              <li><strong>3. Will you have to sell the house?</strong> — We calculate the probability of your shares being called away (assigned) vs. the call expiring worthless.</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              You get a simple verdict: <strong>Strong Buy</strong>, <strong>Buy</strong>, <strong>Caution</strong>, or <strong>Avoid</strong> — with a specific call recommendation and plain-English explanation.
            </p>
          </div>

          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label htmlFor="sa-symbol" className="text-sm font-medium">Stock Symbol</label>
              <Input
                id="sa-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="e.g. AAPL, MSFT, KO"
                onKeyDown={(e) => e.key === "Enter" && analyze()}
              />
              <p className="text-xs text-muted-foreground mt-1">Any stock or ETF you&apos;d consider holding for 10+ years</p>
            </div>
            <div className="w-32">
              <label htmlFor="sa-contracts" className="text-sm font-medium">Contracts</label>
              <Input
                id="sa-contracts"
                type="number"
                min={1}
                value={contracts}
                onChange={(e) => setContracts(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1"># of contracts</p>
            </div>
            <Button onClick={analyze} disabled={!symbol.trim() || loading}>
              <Home className="mr-2 h-4 w-4" />
              Analyze
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center space-y-2">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Analyzing stock quality and option chains...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-medium">Error</span>
          </div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => { setError(null); setSymbol(""); }}>Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const vc = verdictConfig[data.verdict] ?? verdictConfig.caution;
  const VerdictIcon = vc.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Strategy Advisor: {data.symbol} @ {formatCurrency(data.currentPrice)}
            </span>
            <Button variant="outline" size="sm" onClick={() => { setData(null); setSymbol(""); }}>
              New Analysis
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.barsAnalyzed && (
            <p className="text-xs text-muted-foreground">
              {data.barsAnalyzed} trading days analyzed via {data.dataSource}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Verdict Banner */}
      <Card className={cn("border-2", vc.border)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <VerdictIcon className={cn("h-6 w-6", vc.color === "profit" ? "text-green-500" : vc.color === "warning" ? "text-amber-500" : "text-red-500")} />
            Verdict: {vc.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{data.verdictExplanation}</p>
          <div className="border-t pt-3 space-y-2">
            {data.summary.map((line, i) => (
              <p key={i} className="text-sm text-muted-foreground flex gap-2">
                <span className="text-primary">•</span>
                {line}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stock Quality Score */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stock Quality Score: Grade {data.quality.grade}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Like grading a neighborhood — is this a stock you&apos;d want to own for 10+ years?
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold">
              <Badge variant={(gradeColors[data.quality.grade] ?? "warning") as "profit" | "warning" | "loss"}>
                Grade {data.quality.grade}
              </Badge>
            </div>
            <div className="text-2xl font-bold">{data.quality.total}/100</div>
          </div>

          {/* Component scores */}
          <div className="grid gap-3 sm:grid-cols-5">
            <ScoreBar label="Trend" value={data.quality.components.trend} hint="Price vs 200-day avg" />
            <ScoreBar label="Stability" value={data.quality.components.stability} hint="Low volatility = stable" />
            <ScoreBar label="Growth" value={data.quality.components.growth} hint="Returns over 1y/3y/5y" />
            <ScoreBar label="Drawdown Risk" value={data.quality.components.drawdownRisk} hint="Worst historical decline" />
            <ScoreBar label="Technical Bias" value={data.quality.components.technicalBias} hint="15+ indicator signal" />
          </div>

          {/* Strengths & Concerns */}
          <div className="grid gap-4 sm:grid-cols-2">
            {data.quality.strengths.length > 0 && (
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 space-y-1">
                <p className="text-sm font-medium text-green-600 dark:text-green-500">Strengths</p>
                {data.quality.strengths.map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground flex gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                    {s}
                  </p>
                ))}
              </div>
            )}
            {data.quality.concerns.length > 0 && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1">
                <p className="text-sm font-medium text-red-600 dark:text-red-500">Concerns</p>
                {data.quality.concerns.map((c, i) => (
                  <p key={i} className="text-xs text-muted-foreground flex gap-1">
                    <AlertTriangle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                    {c}
                  </p>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Best Pick */}
      {data.bestPick && (
        <Card className="border-2 border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-5 w-5 text-primary" />
              Best Call to Sell
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Strike" value={formatCurrency(data.bestPick.strike)} hint="Price you'd sell at if assigned" />
              <MetricCard label="DTE" value={`${data.bestPick.dte} days`} hint="Days until expiration" />
              <MetricCard label="Premium / Share" value={formatCurrency(data.bestPick.premiumPerShare)} hint="Income you collect upfront" />
              <MetricCard label="Premium Yield" value={formatPercent(data.bestPick.premiumYield, 2)} hint="Premium as % of stock price" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Annualized Yield" value={formatPercent(data.bestPick.annualizedYield, 2)} hint="If you could repeat this all year" />
              <MetricCard
                label="Chance of Expiring Worthless"
                value={data.bestPick.expireWorthlessProbability != null ? formatPercent(data.bestPick.expireWorthlessProbability, 0) : "—"}
                hint="You keep premium + shares"
                valueClass="text-profit"
              />
              <MetricCard
                label="Chance of Assignment"
                value={data.bestPick.assignmentProbability != null ? formatPercent(data.bestPick.assignmentProbability, 0) : "—"}
                hint="You sell shares at the strike"
                valueClass="text-loss"
              />
              <MetricCard
                label="Total Return if Assigned"
                value={formatPercent(data.bestPick.totalReturnIfAssigned, 2)}
                hint="Premium + stock appreciation"
                valueClass="text-profit"
              />
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              {(() => {
                const sl = strategyLabels[data.bestPick!.strategy];
                if (!sl) return null;
                return (
                  <>
                    <Badge variant={sl.color}>{sl.label}</Badge>
                    <p className="text-xs text-muted-foreground mt-1">{sl.hint}</p>
                  </>
                );
              })()}
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium mb-1">What this means:</p>
              <p className="text-sm text-muted-foreground">{data.bestPick.explanation}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* DTE Comparison Table */}
      {data.dteComparisons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Compare by Expiration Date</CardTitle>
            <p className="text-xs text-muted-foreground">
              See how premium yield and assignment probability change with different expiration dates.
              Shorter DTE = faster time decay but less premium per trade. Longer DTE = more premium but more risk.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DTE</TableHead>
                  <TableHead>Expiration</TableHead>
                  <TableHead className="text-right">Calls Analyzed</TableHead>
                  <TableHead className="text-right">Avg Yield</TableHead>
                  <TableHead className="text-right">Avg Assignment Prob</TableHead>
                  <TableHead className="text-right">Best Strike</TableHead>
                  <TableHead className="text-right">Best Yield</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dteComparisons.map((d) => (
                  <TableRow key={d.dte}>
                    <TableCell className="font-medium">{d.dte}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.expiration}</TableCell>
                    <TableCell className="text-right font-mono">{d.callsAnalyzed}</TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(d.avgPremiumYield, 2)}</TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(d.avgAssignmentProb, 0)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {d.bestCall ? formatCurrency(d.bestCall.strike) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {d.bestCall ? formatPercent(d.bestCall.premiumYield, 2) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recommended DTE */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recommended Expiration: {data.recommendedDTE.dte} Days</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{data.recommendedDTE.reason}</p>
        </CardContent>
      </Card>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4" />
              Warnings ({data.warnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {data.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-warning">•</span>
                  {w}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScoreBar({ label, value, hint }: { label: string; value: number; hint: string }) {
  const color = value >= 70 ? "bg-green-500" : value >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium">{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${value}%` }} />
      </div>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

function MetricCard({ label, value, hint, valueClass }: { label: string; value: string; hint: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-bold mt-1", valueClass)}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}
