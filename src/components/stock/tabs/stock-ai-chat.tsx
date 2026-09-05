"use client";

import { AIChat } from "@/components/ai/ai-chat";
import { useAIStub } from "@/components/ai/stub-client";

const STOCK_SUGGESTIONS = [
  "Find the best covered call for income while keeping the strike at least 15% OTM.",
  "Compare 30, 45, and 90 DTE covered calls. Which has the best annualized total return?",
  "Find a LEAP covered call with ~10-15% premium and strike at least 30% above current price.",
  "What cash-secured put gives me an effective entry 10% below the current price?",
  "What's the historical probability this stock rises 15% in 45 days?",
];

export function StockAIChat({ symbol }: { symbol: string }) {
  const stub = useAIStub();
  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        Asking about <span className="font-semibold">{symbol}</span>. The AI will fetch live data and run
        deterministic scanners for this symbol via tool calls.
      </div>
      <AIChat isStub={stub} overrideSuggestions={STOCK_SUGGESTIONS} symbol={symbol} />
    </div>
  );
}
