import { describe, expect, it } from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import { z } from "zod";
import { defineGenerator, GenerationError, range } from "../src/index.js";

describe("Generator module", () => {
  it("throws clear error when no LanguageModel is provided", async () => {
    const generator = defineGenerator({
      schema: z.object({ title: z.string() }),
    });

    await expect(generator.generate()).rejects.toThrow(
      "No LanguageModel provided"
    );
  });

  it("successfully generates valid object using MockLanguageModelV1", async () => {
    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 20 },
        text: JSON.stringify({ title: "Forest Goblin Patrol", level: 3 }),
      }),
    });

    const generator = defineGenerator({
      schema: z.object({
        title: z.string(),
        level: z.number(),
      }),
      model: mockModel,
    });

    const result = await generator.generate();

    expect(result).toEqual({
      title: "Forest Goblin Patrol",
      level: 3,
    });
  });

  it("throws GenerationError with correct path when output is structurally invalid", async () => {
    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 20 },
        text: JSON.stringify({ title: "Forest Goblin Patrol", level: "not-a-number" }),
      }),
    });

    const generator = defineGenerator({
      schema: z.object({
        title: z.string(),
        level: z.number(),
      }),
      model: mockModel,
    });

    try {
      await generator.generate();
      expect.fail("Should have thrown GenerationError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(GenerationError);
      const genErr = err as GenerationError;
      expect(genErr.attempts).toBe(1);
      expect(genErr.errors).toHaveLength(1);
      expect(genErr.errors[0]?.path).toBe("level");
    }
  });

  it("throws GenerationError with rule range when zod passes but balance constraint fails", async () => {
    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 20 },
        text: JSON.stringify({ title: "Forest Goblin Patrol", level: 99 }),
      }),
    });

    const generator = defineGenerator({
      schema: z.object({
        title: z.string(),
        level: z.number(),
      }),
      constraints: [range("level", [1, 10])],
      model: mockModel,
    });

    try {
      await generator.generate();
      expect.fail("Should have thrown GenerationError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(GenerationError);
      const genErr = err as GenerationError;
      expect(genErr.attempts).toBe(1);
      expect(genErr.errors).toHaveLength(1);
      expect(genErr.errors[0]?.path).toBe("level");
      expect(genErr.errors[0]?.rule).toBe("range");
      expect(genErr.errors[0]?.currentValue).toBe(99);
      expect(genErr.errors[0]?.allowed).toEqual([1, 10]);
    }
  });
});
