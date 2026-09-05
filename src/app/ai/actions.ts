"use server";

import { runChatTurn } from "@/features/ai/chat-orchestrator";
import { isAIStub } from "@/features/ai/provider";
import type { AIMessage } from "@/features/ai/provider";

export interface ChatResult {
  content: string;
  dataQualityWarnings: string[];
  iterations: number;
  capped: boolean;
  isStub: boolean;
  model: string;
  messages: AIMessage[];
}

export async function sendChatMessage(
  history: AIMessage[],
  message: string,
  symbol?: string,
  model?: string,
): Promise<ChatResult> {
  const { final, iterations, capped, messages } = await runChatTurn(history, message, symbol, model);
  return {
    content: final.content,
    dataQualityWarnings: final.dataQualityWarnings,
    iterations,
    capped,
    isStub: isAIStub(),
    model: final.model,
    messages,
  };
}
