/**
 * OpenAI-compatible AI provider with function calling.
 *
 * Implements the `AIProvider` contract. The AI receives the conversation plus
 * the tool definitions; when it requests a tool, the server executes it
 * (see `tool-executor.ts`) and feeds the deterministic result back. The AI
 * then produces natural-language interpretation.
 *
 * The AI NEVER receives raw market-data credentials and NEVER fabricates
 * financial inputs — every number it cites comes from a tool result produced
 * by the calculation engine.
 *
 * Works with any OpenAI-compatible endpoint (OpenAI, Azure OpenAI via gateway,
 * OpenRouter, local llama.cpp server, etc.) by setting AI_BASE_URL.
 */

import "server-only";
import type {
  AIMessage,
  AIResponse,
  AIToolCall,
  AIToolDefinition,
  AIProvider,
  AIContext,
} from "./provider";

export interface OpenAIConfig {
  apiKey: string;
  baseUrl: string; // e.g. https://api.openai.com/v1
  model: string; // e.g. gpt-4o-mini
}

interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
}

interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: {
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: string;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly model: string;
  tools: AIToolDefinition[];
  private config: OpenAIConfig;

  constructor(config: OpenAIConfig, tools: AIToolDefinition[]) {
    this.config = config;
    this.model = config.model;
    this.tools = tools;
  }

  async complete(messages: AIMessage[], context: AIContext): Promise<AIResponse> {
    const systemPrompt = buildSystemPrompt(context);
    const openaiMessages: OpenAIChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages.map(toOpenAIMessage),
    ];

    const toolDefs: OpenAIToolDef[] = this.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const dataQualityWarnings: string[] = [];

    // Single completion. The caller (chat orchestrator) is responsible for
    // executing tool calls and re-invoking with tool results — this keeps the
    // provider a thin transport layer and the orchestration logic testable.
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          model: this.config.model,
          messages: openaiMessages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          tool_choice: toolDefs.length > 0 ? "auto" : undefined,
          temperature: 0.2,
          max_tokens: 2000,
        }),
      });
    } catch (e) {
      dataQualityWarnings.push(`AI provider network error: ${(e as Error).message}`);
      return {
        content:
          "I couldn't reach the AI provider. The deterministic scanners and calculators remain fully available — try the Covered Calls or Cash-Secured Puts tabs.",
        toolCalls: [],
        provider: this.name,
        model: this.model,
        dataQualityWarnings,
      };
    }

    if (res.status === 401 || res.status === 403) {
      dataQualityWarnings.push("AI provider rejected the API key (401/403).");
      return {
        content: "The AI API key was rejected. Check AI_API_KEY in .env.local. Scanners and calculators still work without AI.",
        toolCalls: [],
        provider: this.name,
        model: this.model,
        dataQualityWarnings,
      };
    }
    if (res.status === 429) {
      dataQualityWarnings.push("AI provider rate limit (429).");
      return {
        content: "The AI provider rate limit was hit. Please wait a moment and try again.",
        toolCalls: [],
        provider: this.name,
        model: this.model,
        dataQualityWarnings,
      };
    }
    if (!res.ok) {
      dataQualityWarnings.push(`AI provider HTTP ${res.status}.`);
      const text = await res.text().catch(() => "");
      return {
        content: `The AI provider returned an error (HTTP ${res.status}). ${text.slice(0, 200)}`,
        toolCalls: [],
        provider: this.name,
        model: this.model,
        dataQualityWarnings,
      };
    }

    const body = (await res.json()) as OpenAIChatResponse;
    const choice = body.choices[0];
    if (!choice) {
      dataQualityWarnings.push("AI provider returned no choices.");
      return {
        content: "The AI provider returned an empty response.",
        toolCalls: [],
        provider: this.name,
        model: this.model,
        dataQualityWarnings,
      };
    }

    const toolCalls: AIToolCall[] = (choice.message.tool_calls ?? []).map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        dataQualityWarnings.push(`Failed to parse arguments for tool ${tc.function.name}.`);
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });

    return {
      content: choice.message.content ?? "",
      toolCalls,
      provider: this.name,
      model: body.model ?? this.model,
      dataQualityWarnings,
    };
  }
}

function toOpenAIMessage(m: AIMessage): OpenAIChatMessage {
  return {
    role: m.role,
    content: m.content,
    tool_call_id: m.toolCallId,
    tool_calls: m.toolCalls?.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    })),
  };
}

function buildSystemPrompt(context: AIContext): string {
  const lines: string[] = [
    "You are an options strategy assistant for a covered-call / cash-secured-put income platform.",
    "Your job is to understand the user's goal, call the provided tools to retrieve REAL data and deterministic calculations, then explain the trade-offs.",
    "",
    "STRICT RULES:",
    "1. NEVER invent stock prices, option premiums, Greeks, IV, volumes, earnings dates, or any market data. Always call a tool to get it.",
    "2. NEVER invent calculation results. Always call calculateCoveredCall / calculateCashSecuredPut / scanCoveredCalls / scanCashSecuredPuts.",
    "3. Every number you cite MUST come from a tool result. If a tool returned no data, say so.",
    "4. Distinguish FACTS (market data), CALCULATIONS (deterministic outputs), ESTIMATES (historical/probability), and INTERPRETATION (your reasoning).",
    "5. For covered calls, ALWAYS discuss the trade-off between premium income and the stock appreciation surrendered. A higher premium is NOT automatically better.",
    "6. Provide 3-5 ranked choices (Conservative / Balanced / Income Focused) when recommending, not a single contract.",
    "7. 'No trade' is a valid result. If nothing meets the user's constraints, say so rather than degrading constraints silently.",
    "8. Annualized rates are comparison tools only — never present them as expected or guaranteed returns.",
    "9. Do not give definitive personalized tax or investment advice. Label estimates as estimates.",
    "",
  ];

  if (context.portfolio) {
    const p = context.portfolio;
    lines.push("USER PORTFOLIO CONTEXT (facts from the database):");
    if (p.stockLots.length > 0) {
      lines.push("Holdings:");
      for (const lot of p.stockLots) {
        lines.push(
          `  - ${lot.symbol}: ${lot.shares} shares, cost basis $${lot.costBasisPerShare}, purchased ${lot.purchaseDate}${lot.protectedFromCalls ? " [protected from calls]" : ""}`,
        );
      }
    } else {
      lines.push("  (no holdings entered yet)");
    }
    if (p.optionPositions.filter((o) => o.status === "OPEN").length > 0) {
      lines.push("Open option positions:");
      for (const op of p.optionPositions.filter((o) => o.status === "OPEN")) {
        lines.push(`  - ${op.contracts}x ${op.optionType} ${op.symbol} ${op.strike} ${op.expiration} (${op.strategyType})`);
      }
    }
    if (p.goals[0]) {
      const g = p.goals[0];
      lines.push("Goals:");
      if (g.monthlyIncomeTarget) lines.push(`  - Monthly income target: $${g.monthlyIncomeTarget}`);
      if (g.annualTotalReturnTarget) lines.push(`  - Annual total return target: ${(g.annualTotalReturnTarget * 100).toFixed(0)}%`);
      if (g.minimumOTMPercent) lines.push(`  - Min OTM: ${(g.minimumOTMPercent * 100).toFixed(0)}%`);
      if (g.maximumDelta) lines.push(`  - Max delta: ${g.maximumDelta}`);
      if (g.preferredDteMin && g.preferredDteMax) lines.push(`  - Preferred DTE: ${g.preferredDteMin}-${g.preferredDteMax}`);
      if (g.riskProfile) lines.push(`  - Risk profile: ${g.riskProfile}`);
    }
  }

  if (context.symbol) {
    lines.push(``, `The user is currently viewing ${context.symbol}. Use tools to fetch its data if relevant.`);
  }

  lines.push("", "Be concise. Use markdown. Lead with the direct answer, then the reasoning.");

  return lines.join("\n");
}
