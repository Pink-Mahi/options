import { NextResponse } from "next/server";
import { isAIStub, getCurrentModel, getAvailableModels } from "@/features/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    isStub: isAIStub(),
    currentModel: getCurrentModel(),
    availableModels: getAvailableModels(),
  });
}
