import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export function resolveModel(modelStr: string): LanguageModel {
  if (!modelStr.includes(":")) {
    throw new Error(
      `Invalid --model format "${modelStr}". Expected "provider:model" (e.g. openai:gpt-4o-mini).`
    );
  }

  const colonIdx = modelStr.indexOf(":");
  const provider = modelStr.slice(0, colonIdx).trim().toLowerCase();
  const modelName = modelStr.slice(colonIdx + 1).trim();

  if (!provider || !modelName) {
    throw new Error(
      `Invalid --model format "${modelStr}". Provider and model name must not be empty.`
    );
  }

  if (provider === "openai") {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    return openai(modelName);
  }

  if (provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    return anthropic(modelName);
  }

  throw new Error(
    `Unsupported provider "${provider}". Supported providers: openai, anthropic.`
  );
}
