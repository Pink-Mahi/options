/**
 * AI chat orchestrator.
 *
 * Runs the tool-call loop:
 *   1. Send conversation + tools to the AI provider.
 *   2. If the AI requests tools, execute them deterministically (tool-executor)
 *      and append the results as tool messages.
 *   3. Re-send to the AI for interpretation.
 *   4. Repeat until the AI produces a final answer with no tool calls (or we
 *      hit a safety cap on iterations).
 *
 * The AI never executes code. Every number it cites came from a tool result.
 */

import "server-only";
import { getPortfolio } from "@/lib/database/portfolio-repo";
import { getSessionUser } from "@/lib/auth";
import { executeTool } from "./tool-executor";
import { AI_TOOLS } from "./tools";
import { getAIProvider, getAIProviderForModel, isAIStub, type AIMessage, type AIContext, type AIResponse } from "./provider";

const MAX_TOOL_ITERATIONS = 4;

export interface ChatTurnResult {
  messages: AIMessage[]; // full conversation including tool results
  final: AIResponse; // last assistant response
  iterations: number;
  /** True if we hit the safety cap without a final answer. */
  capped: boolean;
}

export async function runChatTurn(
  history: AIMessage[],
  userMessage: string,
  symbol?: string,
  model?: string,
): Promise<ChatTurnResult> {
  const sessionUser = await getSessionUser();
  const userId = sessionUser?.id;
  const portfolio = userId ? await getPortfolio(userId).catch(() => null) : null;
  const context: AIContext = { portfolio, goals: null, symbol };

  const messages: AIMessage[] = [...history, { role: "user", content: userMessage }];
  const provider = getAIProviderForModel(model);

  let iterations = 0;
  let capped = false;
  let final: AIResponse;

  // Stub provider doesn't do tool calls — return its templated response directly.
  if (isAIStub()) {
    final = await provider.complete(messages, context);
    return { messages, final, iterations: 0, capped: false };
  }

  // Ensure tools are registered (OpenAI provider needs them).
  if (provider.tools.length === 0) {
    provider.tools = AI_TOOLS;
  }

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    const response = await provider.complete(messages, context);

    if (response.toolCalls.length === 0) {
      final = response;
      break;
    }

    // Append the assistant message with tool calls.
    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
    });

    // Execute each requested tool and append the result.
    for (const tc of response.toolCalls) {
      const exec = await executeTool(tc.name, tc.arguments, userId);
      messages.push({
        role: "tool",
        content: JSON.stringify(exec.result ?? { error: exec.error, warnings: exec.warnings }),
        toolCallId: tc.id,
      });
    }

    if (iterations === MAX_TOOL_ITERATIONS) {
      capped = true;
      // Force a final summary call without tools so the AI must answer.
      const summaryProvider = getAIProviderForModel(model);
      summaryProvider.tools = [];
      final = await summaryProvider.complete(
        [...messages, { role: "user", content: "Summarize the tool results above into a final answer for the user. Do not request more tools." }],
        context,
      );
      break;
    }
  }

  // If we exited the loop without setting `final` (shouldn't happen, but guard).
  if (!final!) {
    final = {
      content: "I reached the tool-call limit. Here is what I gathered — please refine your question.",
      toolCalls: [],
      provider: provider.name,
      model: provider.model,
      dataQualityWarnings: ["Tool-call iteration cap reached."],
    };
  }

  return { messages, final, iterations, capped };
}
