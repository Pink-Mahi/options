"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Eye, Bell, Plus, Trash2, AlertCircle, Check, X, Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input, Label, Select } from "@/components/ui";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { WatchlistEntry, AlertEntry, AlertEvaluation, AlertRuleType } from "@/lib/types";

interface WatchlistItem extends WatchlistEntry {
  currentPrice?: number;
  priceChange?: number;
}

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [evaluations, setEvaluations] = useState<AlertEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddWatch, setShowAddWatch] = useState(false);
  const [showAddAlert, setShowAddAlert] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newTargetPrice, setNewTargetPrice] = useState("");

  const load = useCallback(async () => {
    try {
      const [wRes, aRes] = await Promise.all([
        fetch("/api/watchlist", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/alerts", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setWatchlist(wRes.items ?? []);
      setAlerts(aRes.alerts ?? []);
      setEvaluations(aRes.evaluations ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addWatchItem() {
    if (!newSymbol.trim()) return;
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: newSymbol.toUpperCase(),
        notes: newNotes || null,
        targetPrice: newTargetPrice ? Number(newTargetPrice) : null,
      }),
    });
    setNewSymbol(""); setNewNotes(""); setNewTargetPrice("");
    setShowAddWatch(false);
    load();
  }

  async function removeWatchItem(id: string) {
    if (!confirm("Remove this stock from your watchlist?")) return;
    await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
    load();
  }

  async function toggleAlert(id: string, enabled: boolean) {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    load();
  }

  async function removeAlert(id: string) {
    if (!confirm("Delete this alert?")) return;
    await fetch(`/api/alerts?id=${id}`, { method: "DELETE" });
    load();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading watchlist…</p>;

  const triggeredAlerts = evaluations.filter((e) => e.triggered);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Watchlist &amp; Alerts</h1>
        <p className="text-sm text-muted-foreground">Track stocks and get notified when conditions are met.</p>
      </div>

      {triggeredAlerts.length > 0 && (
        <Card className="border-loss/50 bg-loss/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-loss">
              <AlertCircle className="h-4 w-4" /> {triggeredAlerts.length} alert{triggeredAlerts.length > 1 ? "s" : ""} triggered
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {triggeredAlerts.map((ev) => (
              <div key={ev.alert.id} className="flex items-center justify-between text-sm">
                <span>
                  <Link href={`/stock/${ev.alert.symbol}`} className="font-medium underline">{ev.alert.symbol}</Link>
                  {" — "}{ev.message}
                </span>
                <Button size="sm" variant="ghost" onClick={() => removeAlert(ev.alert.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Watchlist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Eye className="h-4 w-4" /> Watchlist ({watchlist.length})
              </CardTitle>
              <CardDescription>Stocks you&apos;re monitoring</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowAddWatch(!showAddWatch)}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showAddWatch && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
              <div className="space-y-1">
                <Label className="text-xs">Symbol</Label>
                <Input value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} placeholder="AAPL" className="w-24" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Target price</Label>
                <Input type="number" value={newTargetPrice} onChange={(e) => setNewTargetPrice(e.target.value)} placeholder="150" className="w-28" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Watching for dip" className="w-48" />
              </div>
              <Button size="sm" onClick={addWatchItem}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddWatch(false)}>Cancel</Button>
            </div>
          )}

          {watchlist.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stocks in your watchlist yet. Click &quot;Add&quot; to start tracking.</p>
          ) : (
            <div className="space-y-1">
              {watchlist.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <Link href={`/stock/${item.symbol}`} className="font-bold underline">{item.symbol}</Link>
                    {item.targetPrice != null && (
                      <Badge variant="outline" className="text-xs">
                        <Target className="mr-1 h-3 w-3" /> ${item.targetPrice}
                      </Badge>
                    )}
                    {item.notes && <span className="text-xs text-muted-foreground">{item.notes}</span>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeWatchItem(item.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alerts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4" /> Alerts ({alerts.length})
              </CardTitle>
              <CardDescription>Get notified when conditions are met</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowAddAlert(!showAddAlert)}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showAddAlert && (
            <AddAlertForm
              watchlistSymbols={watchlist.map((w) => w.symbol)}
              onAdd={async (alert) => {
                await fetch("/api/alerts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(alert),
                });
                setShowAddAlert(false);
                load();
              }}
              onCancel={() => setShowAddAlert(false)}
            />
          )}

          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts configured. Click &quot;Add&quot; to create one.</p>
          ) : (
            <div className="space-y-1">
              {alerts.map((alert) => {
                const eval_ = evaluations.find((e) => e.alert.id === alert.id);
                return (
                  <div key={alert.id} className={cn(
                    "flex items-center justify-between rounded-md border p-3",
                    eval_?.triggered && "border-loss/50 bg-loss/5",
                  )}>
                    <div className="flex items-center gap-2">
                      {alert.symbol && <Link href={`/stock/${alert.symbol}`} className="font-bold underline">{alert.symbol}</Link>}
                      <Badge variant="outline" className="text-xs">{alert.ruleType.replace(/_/g, " ")}</Badge>
                      {alert.parameters.threshold != null && (
                        <span className="text-xs text-muted-foreground">
                          threshold: {formatNumber(alert.parameters.threshold, 2)}
                        </span>
                      )}
                      {eval_ && (
                        <span className={cn("text-xs", eval_.triggered ? "text-loss font-medium" : "text-muted-foreground")}>
                          {eval_.message}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleAlert(alert.id, !alert.enabled)}
                      >
                        {alert.enabled ? <Check className="h-3 w-3 text-profit" /> : <X className="h-3 w-3 text-muted-foreground" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeAlert(alert.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AddAlertForm({
  watchlistSymbols,
  onAdd,
  onCancel,
}: {
  watchlistSymbols: string[];
  onAdd: (alert: { symbol: string; ruleType: AlertRuleType; threshold?: number }) => void;
  onCancel: () => void;
}) {
  const [symbol, setSymbol] = useState(watchlistSymbols[0] ?? "");
  const [ruleType, setRuleType] = useState<AlertRuleType>("price_above");
  const [threshold, setThreshold] = useState("");

  const ruleOptions: { value: AlertRuleType; label: string; placeholder: string }[] = [
    { value: "price_above", label: "Price above", placeholder: "150" },
    { value: "price_below", label: "Price below", placeholder: "100" },
    { value: "iv_above", label: "Volatility above", placeholder: "0.5 (50%)" },
    { value: "iv_below", label: "Volatility below", placeholder: "0.2 (20%)" },
    { value: "yield_above", label: "Call yield above", placeholder: "0.02 (2%)" },
    { value: "yield_below", label: "Call yield below", placeholder: "0.005 (0.5%)" },
    { value: "earnings_within_days", label: "Earnings within (days)", placeholder: "7" },
    { value: "delta_above", label: "ATM delta above", placeholder: "0.5" },
    { value: "delta_below", label: "ATM delta below", placeholder: "0.3" },
  ];

  const current = ruleOptions.find((r) => r.value === ruleType);

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label className="text-xs">Symbol</Label>
        <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL" className="w-24" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Rule</Label>
        <Select value={ruleType} onChange={(e) => setRuleType(e.target.value as AlertRuleType)}>
          <option value="">Select rule…</option>
          {ruleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Threshold</Label>
        <Input
          type="number"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder={current?.placeholder ?? "value"}
          className="w-32"
        />
      </div>
      <Button
        size="sm"
        onClick={() => onAdd({
          symbol: symbol.toUpperCase(),
          ruleType,
          threshold: threshold ? Number(threshold) : undefined,
        })}
      >
        Create
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  );
}
