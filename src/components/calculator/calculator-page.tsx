"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, Input } from "@/components/ui";
import { POPULAR_TICKERS } from "@/lib/tickers";

export function CalculatorPage() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");

  function go(s: string) {
    const clean = s.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    if (clean) router.push(`/stock/${clean}?tab=calculator`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Profit calculator</h1>
        <p className="text-sm text-muted-foreground">
          Pick a stock to open the covered-call / cash-secured-put calculator with payoff graph and profit table.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start</CardTitle>
          <CardDescription>Calculations run on real (or demo) option-chain data.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); go(symbol); }} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL" className="pl-8 uppercase" autoFocus />
            </div>
            <Button type="submit">Open</Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {POPULAR_TICKERS.map((t) => (
              <Button key={t} variant="secondary" size="sm" onClick={() => go(t)}>{t}</Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
