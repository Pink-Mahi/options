"use client";

import { useEffect, useState } from "react";
import { Bookmark, Save, Trash2, ChevronDown } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface StrategyPresetInfo {
  id: string;
  name: string;
  strategyType: string;
  minDelta: number;
  maxDelta: number;
  minDte: number;
  maxDte: number;
  minYieldPct: number;
  minOtmPercent: number;
  minDiscountPct: number;
  excludeEarnings: boolean;
}

interface Props {
  strategyType: "COVERED_CALL" | "CASH_SECURED_PUT";
  onApply: (preset: StrategyPresetInfo) => void;
  onSave: (name: string) => void;
  currentFilters: {
    minDelta: number;
    maxDelta: number;
    minDte: number;
    maxDte: number;
    minYieldPct: number;
    minOtmPercent: number;
    minDiscountPct: number;
    excludeEarnings: boolean;
  };
}

export function StrategyPresetSelector({ strategyType, onApply, onSave, currentFilters }: Props) {
  const [presets, setPresets] = useState<StrategyPresetInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    fetch("/api/strategy-presets", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setPresets(data.presets ?? []))
      .catch(() => {});
  }, []);

  const filtered = presets.filter(
    (p) => p.strategyType === strategyType || p.strategyType === "ANY",
  );

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
    setShowSave(false);

    fetch("/api/strategy-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, strategyType, ...currentFilters }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.preset) setPresets((prev) => [data.preset, ...prev]);
      });
  }

  function handleDelete(id: string) {
    fetch(`/api/strategy-presets?id=${id}`, { method: "DELETE" })
      .then(() => setPresets((prev) => prev.filter((p) => p.id !== id)))
      .catch(() => {});
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="gap-1.5"
      >
        <Bookmark className="h-4 w-4" />
        My Strategy
        <ChevronDown className="h-3 w-3" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border bg-popover p-2 shadow-md">
            {filtered.length > 0 ? (
              <div className="max-h-60 space-y-1 overflow-y-auto">
                {filtered.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-secondary"
                  >
                    <button
                      onClick={() => {
                        onApply(p);
                        setOpen(false);
                      }}
                      className="flex-1 text-left"
                    >
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Δ {p.minDelta}-{p.maxDelta} · DTE {p.minDte}-{p.maxDte}
                        {p.minYieldPct > 0 && ` · ≥${p.minYieldPct}% yield`}
                        {p.minOtmPercent > 0 && ` · ≥${p.minOtmPercent}% OTM`}
                      </div>
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="text-muted-foreground hover:text-loss"
                      aria-label="Delete preset"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No saved strategies yet. Set your filters and save them to quickly find the right strike and DTE on any stock.
              </p>
            )}
            <div className="mt-2 border-t pt-2">
              {showSave ? (
                <div className="flex gap-1.5">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Strategy name…"
                    className="h-8 text-sm"
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    autoFocus
                  />
                  <Button size="sm" onClick={handleSave} disabled={!name.trim()}>
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => setShowSave(true)}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save current filters
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
