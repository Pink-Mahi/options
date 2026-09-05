import { isAIStub } from "@/features/ai/provider";
import { AIChat } from "@/components/ai/ai-chat";

export const dynamic = "force-dynamic";

export default function AIPage() {
  const stub = isAIStub();
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">AI strategy assistant</h1>
        <p className="text-sm text-muted-foreground">
          Natural-language options analysis. The AI calls deterministic scanners and calculators via tool functions — it never invents market data.
        </p>
      </div>
      <AIChat isStub={stub} />
    </div>
  );
}
