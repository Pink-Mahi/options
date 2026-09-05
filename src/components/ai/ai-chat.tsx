"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Send, Sparkles, AlertTriangle, Wrench, ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Input } from "@/components/ui";
import { sendChatMessage, type ChatResult } from "@/app/ai/actions";
import { useAIStatus, type AIModelInfo } from "@/components/ai/stub-client";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  warnings?: string[];
  iterations?: number;
  isStub?: boolean;
}

const SUGGESTIONS = [
  "Find the best covered call for AAPL if I want at least 2% premium this month with the strike at least 15% OTM.",
  "Compare selling a 30-day, 45-day, and 90-day covered call on NVDA.",
  "I want a LEAP covered call with ~10-15% premium and the strike at least 30% above the current price.",
  "I'd happily own MSFT at an effective price of $300. Find cash-secured puts that achieve that.",
  "What's my best option for income this month given my portfolio?",
  "Which expiration gives the best annualized premium relative to assignment risk for AMZN?",
];

export function AIChat({
  isStub,
  overrideSuggestions,
  symbol,
}: {
  isStub: boolean;
  overrideSuggestions?: string[];
  symbol?: string;
}) {
  const suggestions = overrideSuggestions ?? SUGGESTIONS;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<ChatResult | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const aiStatus = useAIStatus();
  const [selectedModel, setSelectedModel] = useState<string>("");

  useEffect(() => {
    if (aiStatus.currentModel && !selectedModel) {
      setSelectedModel(aiStatus.currentModel);
    }
  }, [aiStatus.currentModel, selectedModel]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setInput("");
    const userMsg: Message = { role: "user", content: trimmed };
    setMessages((m) => [...m, userMsg]);
    startTransition(async () => {
      // Build the history the server expects (only role/content matter for the stub;
      // the orchestrator reconstructs tool messages from its own loop).
      const history = messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const model = isStub ? undefined : (selectedModel || undefined);
      const result = await sendChatMessage(history, trimmed, symbol, model);
      setLastResult(result);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: result.content,
          warnings: result.dataQualityWarnings,
          iterations: result.iterations,
          isStub: result.isStub,
        },
      ]);
    });
  }

  return (
    <div className="flex h-[70vh] flex-col space-y-3">
      <Card className="flex flex-1 flex-col">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">AI strategy assistant</CardTitle>
              <CardDescription className="text-xs">
                {isStub ? "Demo mode — deterministic stub. Add AI_API_KEY for live AI." : "Live AI with function calling"}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isStub && aiStatus.availableModels.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Model:</span>
                <div className="relative">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={pending}
                    className="appearance-none rounded-md border bg-card py-1 pl-2 pr-7 text-xs font-medium disabled:opacity-50"
                  >
                    {aiStatus.availableModels.map((m: AIModelInfo) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
            )}
            {lastResult && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {lastResult.iterations > 0 && (
                  <Badge variant="outline">
                    <Wrench className="mr-1 h-3 w-3" /> {lastResult.iterations} tool call{lastResult.iterations === 1 ? "" : "s"}
                  </Badge>
                )}
                {lastResult.capped && <Badge variant="warning">capped</Badge>}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded-md border p-3">
            {messages.length === 0 && (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Ask a natural-language question about covered calls, cash-secured puts, LEAPS, or your portfolio income.</p>
                <p className="text-xs">The AI converts your goal into filters, runs the deterministic scanners via tool calls, and explains the trade-offs. It never invents market data.</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {suggestions.map((s) => (
                    <Button key={s} variant="secondary" size="sm" className="text-xs" onClick={() => send(s)}>
                      {s.length > 60 ? s.slice(0, 57) + "…" : s}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {m.content}
                  {m.warnings && m.warnings.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-amber-500/30 pt-2 text-xs text-amber-600 dark:text-amber-400">
                      {m.warnings.map((w, j) => (
                        <div key={j} className="flex items-start gap-1">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pending && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {isStub ? "Generating deterministic analysis…" : "Thinking and calling tools…"}
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about covered calls, cash-secured puts, LEAPS, or your portfolio…"
              disabled={pending}
            />
            <Button type="submit" disabled={pending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
