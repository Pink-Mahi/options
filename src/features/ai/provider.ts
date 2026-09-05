/**
 * AI provider abstraction (OpenAI-compatible).
 *
 * Phase 5 interface — preserved here so Phase 4 functionality is built against
 * the same contract the AI will use. The AI NEVER receives raw market data to
 * invent numbers; it calls structured tool functions that return deterministic
 * calculation-engine results, then produces natural-language interpretation.
 *
 * This file defines the contract and a deterministic stub. The real OpenAI
 * implementation lands in Phase 5 by implementing `AIProvider`.
 */

import type {
  CashSecuredPutCandidate,
  CoveredCallCandidate,
  Portfolio,
} from "@/lib/types";

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: AIToolCall[];
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-ish parameter shape. */
  parameters: Record<string, unknown>;
}

export interface AIResponse {
  content: string;
  toolCalls: AIToolCall[];
  /** Provider that produced the response. */
  provider: string;
  model: string;
  /** Confidence note surfaced to the UI separately from trade attractiveness. */
  dataQualityWarnings: string[];
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** Tools the AI may call (scanner, calculator, portfolio functions). */
  tools: AIToolDefinition[];
  /** Send a conversation with tool results and receive the next response. */
  complete(messages: AIMessage[], context: AIContext): Promise<AIResponse>;
}

/**
 * Context passed to the AI alongside the conversation. Contains ONLY
 * pre-computed facts and portfolio state — never raw market credentials.
 */
export interface AIContext {
  portfolio: Portfolio | null;
  goals: string | null;
  /** Pre-computed candidates the AI is allowed to reference. */
  coveredCallCandidates?: CoveredCallCandidate[];
  cashSecuredPutCandidates?: CashSecuredPutCandidate[];
  /** Symbol the user is currently analyzing, if any. */
  symbol?: string;
}

// ---------------------------------------------------------------------------
// Deterministic stub (Phase 4). Returns templated analysis from the
// calculation engine so the app is fully functional without an AI key.
// ---------------------------------------------------------------------------

export class StubAIProvider implements AIProvider {
  readonly name = "stub";
  readonly model = "stub-v0";
  tools: AIToolDefinition[] = [];

  async complete(messages: AIMessage[], context: AIContext): Promise<AIResponse> {
    const last = [...messages].reverse().find((m) => m.role === "user");
    const userText = last?.content ?? "";
    const cands = context.coveredCallCandidates ?? [];
    const top = cands.slice(0, 3);

    if (top.length === 0) {
      return {
        content:
          "AI assistant is not yet enabled (Phase 5). No pre-computed candidates were provided for analysis. " +
          "The deterministic scanners and calculators remain fully functional without AI.",
        toolCalls: [],
        provider: this.name,
        model: this.model,
        dataQualityWarnings: ["AI provider is a stub — Phase 5 not yet active."],
      };
    }

    const lines = top.map((c, i) => {
      const label = i === 0 ? "Balanced" : i === 1 ? "Conservative" : "Income Focused";
      return `## ${label}\nStrike: $${c.contract.strike}\nExpiration: ${c.contract.expiration}\nPremium: $${c.premiumPerContract.toFixed(0)}\nOTM: ${(c.strikeOtmPercent * 100).toFixed(1)}%\nDelta: ${c.delta?.toFixed(2) ?? "n/a"}\nPremium Yield: ${(c.premiumYield * 100).toFixed(2)}%\nMaximum Total Return: ${(c.maxTotalReturn * 100).toFixed(1)}%`;
    });

    return {
      content:
        `You asked: "${userText.slice(0, 200)}".\n\nAI assistant is not yet enabled (Phase 5). ` +
        `Below are the top ${top.length} deterministic candidates from the scanner, ranked by your objective:\n\n` +
        lines.join("\n\n"),
      toolCalls: [],
      provider: this.name,
      model: this.model,
      dataQualityWarnings: ["AI provider is a stub — Phase 5 not yet active."],
    };
  }
}

/** Curated list of common OpenAI-compatible models. */
export const AI_MODELS: { id: string; label: string; description: string }[] = [
  { id: "gpt-4o", label: "GPT-4o", description: "Best reasoning — slower, higher cost" },
  { id: "gpt-4o-mini", label: "GPT-4o mini", description: "Fast & affordable — recommended default" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo", description: "Strong reasoning, large context" },
  { id: "gpt-4.1", label: "GPT-4.1", description: "Latest GPT-4.1 — improved coding & reasoning" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", description: "Compact GPT-4.1 — fast & capable" },
  { id: "o3-mini", label: "o3-mini", description: "Reasoning-optimized — slower but thorough" },
  { id: "o4-mini", label: "o4-mini", description: "Latest reasoning model — balanced speed & depth" },
];

let _ai: AIProvider | null = null;
export function getAIProvider(): AIProvider {
  if (_ai) return _ai;
  const key = process.env.AI_API_KEY ?? "";
  const baseUrl = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  if (key) {
    // Lazy require to avoid loading the server-only OpenAI provider in tests.
    const { OpenAIProvider } = require("./openai-provider") as typeof import("./openai-provider");
    const { AI_TOOLS } = require("./tools") as typeof import("./tools");
    _ai = new OpenAIProvider({ apiKey: key, baseUrl, model }, AI_TOOLS);
  } else {
    _ai = new StubAIProvider();
  }
  return _ai;
}

/**
 * Returns a provider configured with a specific model override.
 * When `model` is omitted or matches the cached default, returns the singleton.
 * Otherwise creates a fresh instance for this request.
 */
export function getAIProviderForModel(model?: string): AIProvider {
  if (!model) return getAIProvider();
  const defaultProvider = getAIProvider();
  if (defaultProvider.model === model) return defaultProvider;
  if (defaultProvider.name === "stub") return defaultProvider;

  const key = process.env.AI_API_KEY ?? "";
  const baseUrl = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
  const { OpenAIProvider } = require("./openai-provider") as typeof import("./openai-provider");
  const { AI_TOOLS } = require("./tools") as typeof import("./tools");
  return new OpenAIProvider({ apiKey: key, baseUrl, model }, AI_TOOLS);
}

/** Returns the env-configured default model name (or "stub-v0"). */
export function getCurrentModel(): string {
  return getAIProvider().model;
}

/** Returns the list of available models for UI selection. */
export function getAvailableModels(): { id: string; label: string; description: string }[] {
  return AI_MODELS;
}

/** True when the active AI provider is the deterministic stub. */
export function isAIStub(): boolean {
  return getAIProvider().name === "stub";
}

/** Reset the cached provider (used by tests). */
export function resetAIProvider(): void {
  _ai = null;
}
