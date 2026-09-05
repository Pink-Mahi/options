"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Button } from "@/components/ui";
import { POPULAR_TICKERS } from "@/lib/tickers";

export default function SearchPage() {
  const router = useRouter();
  const [q, setQ] = useState("");

  function go(symbol: string) {
    const clean = symbol.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    if (clean) router.push(`/stock/${clean}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Search a stock</h1>
        <p className="text-sm text-muted-foreground">
          Enter a ticker to load the quote, options chain, and full analysis.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ticker lookup</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go(q);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="e.g. AAPL"
                className="pl-8 uppercase"
                autoFocus
              />
            </div>
            <Button type="submit">Analyze</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Popular tickers</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {POPULAR_TICKERS.map((t) => (
            <Button key={t} variant="secondary" size="sm" onClick={() => go(t)}>
              {t}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
