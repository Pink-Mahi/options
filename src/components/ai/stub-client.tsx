"use client";

import { useEffect, useState } from "react";

export interface AIModelInfo {
  id: string;
  label: string;
  description: string;
}

export interface AIStatus {
  isStub: boolean;
  currentModel: string;
  availableModels: AIModelInfo[];
}

/**
 * Client-side hook for AI provider status.
 * Returns isStub, currentModel, and availableModels from the server.
 */
export function useAIStatus(): AIStatus {
  const [status, setStatus] = useState<AIStatus>({
    isStub: true,
    currentModel: "stub-v0",
    availableModels: [],
  });
  useEffect(() => {
    fetch("/api/ai/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: Partial<AIStatus>) => setStatus({
        isStub: Boolean(b.isStub),
        currentModel: b.currentModel ?? "stub-v0",
        availableModels: b.availableModels ?? [],
      }))
      .catch(() => setStatus({ isStub: true, currentModel: "stub-v0", availableModels: [] }));
  }, []);
  return status;
}

/** Backward-compatible hook returning just the isStub boolean. */
export function useAIStub(): boolean {
  return useAIStatus().isStub;
}
