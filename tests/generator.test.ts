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

  it("throws GenerationError with correct path when output is structurally invalid (when repairs exhausted)", async () => {
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
      maxRepairs: 0,
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

  it("throws GenerationError with rule range when zod passes but balance constraint fails (repairs exhausted)", async () => {
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
      maxRepairs: 0,
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

  describe("repair loop", () => {
    it("recovers from invalid object on 2nd attempt (attempts = 2)", async () => {
      const responses = [
        JSON.stringify({ title: "Quest 1", level: 99 }),
        JSON.stringify({ title: "Quest 1", level: 5 }),
      ];

      let callCount = 0;
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: "json",
        doGenerate: async () => {
          const text = responses[callCount++] ?? responses[responses.length - 1];
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 20 },
            text,
          };
        },
      });

      const generator = defineGenerator({
        schema: z.object({
          title: z.string(),
          level: z.number(),
        }),
        constraints: [range("level", [1, 10])],
        model: mockModel,
      });

      const result = await generator.generate();

      expect(result).toEqual({ title: "Quest 1", level: 5 });
      expect(callCount).toBe(2);
    });

    it("throws GenerationError with attempts = 4 when all 4 attempts fail", async () => {
      let callCount = 0;
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: "json",
        doGenerate: async () => {
          callCount++;
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 20 },
            text: JSON.stringify({ title: "Quest 1", level: 99 }),
          };
        },
      });

      const generator = defineGenerator({
        schema: z.object({
          title: z.string(),
          level: z.number(),
        }),
        constraints: [range("level", [1, 10])],
        model: mockModel,
        maxRepairs: 3,
      });

      try {
        await generator.generate();
        expect.fail("Should have thrown GenerationError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(GenerationError);
        const genErr = err as GenerationError;
        expect(genErr.attempts).toBe(4);
        expect(callCount).toBe(4);
        expect(genErr.errors[0]?.currentValue).toBe(99);
      }
    });

    it("repair prompt contains issues from the LAST failed attempt", async () => {
      const promptsReceived: string[] = [];
      const responses = [
        JSON.stringify({ title: "Quest 1", level: 99 }),
        JSON.stringify({ title: "Quest 1", level: 500 }),
        JSON.stringify({ title: "Quest 1", level: 5 }),
      ];

      let callCount = 0;
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: "json",
        doGenerate: async (options) => {
          promptsReceived.push(JSON.stringify(options.prompt));
          const text = responses[callCount++] ?? responses[responses.length - 1];
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 20 },
            text,
          };
        },
      });

      const generator = defineGenerator({
        schema: z.object({
          title: z.string(),
          level: z.number(),
        }),
        constraints: [range("level", [1, 10])],
        model: mockModel,
      });

      await generator.generate();

      expect(callCount).toBe(3);
      const thirdCallPrompt = promptsReceived[2];
      expect(thirdCallPrompt).toContain("500");
    });

    it("repair prompt contains full base prompt options (systemPrompt, schema, params, avoidNames, examples)", async () => {
      const promptsReceived: string[] = [];
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: "json",
        doGenerate: async (options) => {
          promptsReceived.push(JSON.stringify(options.prompt));
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 20 },
            text: JSON.stringify({ title: "Quest 1", level: 99 }),
          };
        },
      });

      const generator = defineGenerator({
        schema: z.object({
          title: z.string().describe("Title of quest"),
          level: z.number().describe("Level requirement"),
        }),
        systemPrompt: "You are a RPG generator.",
        examples: [{ title: "Ex 1", level: 1 }],
        constraints: [range("level", [1, 10])],
        model: mockModel,
        maxRepairs: 1,
      });

      try {
        await generator.generate({ theme: "dark" }, { avoidNames: ["AvoidQuest"] });
      } catch {
        // expected to throw GenerationError
      }

      expect(promptsReceived).toHaveLength(2);
      const repairPrompt = promptsReceived[1];
      expect(repairPrompt).toContain("You are a RPG generator.");
      expect(repairPrompt).toContain("Field instructions:");
      expect(repairPrompt).toContain("Generation parameters: theme=dark");
      expect(repairPrompt).toContain("Already generated, do NOT repeat or closely imitate: AvoidQuest");
      expect(repairPrompt).toContain("Examples of valid objects:");
      expect(repairPrompt).toContain("The previously generated object was invalid.");
    });

    it("disables repair loop when maxRepairs: 0", async () => {
      let callCount = 0;
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: "json",
        doGenerate: async () => {
          callCount++;
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 20 },
            text: JSON.stringify({ title: "Quest 1", level: 99 }),
          };
        },
      });

      const generator = defineGenerator({
        schema: z.object({
          title: z.string(),
          level: z.number(),
        }),
        constraints: [range("level", [1, 10])],
        model: mockModel,
        maxRepairs: 0,
      });

      try {
        await generator.generate();
        expect.fail("Should have thrown GenerationError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(GenerationError);
        const genErr = err as GenerationError;
        expect(genErr.attempts).toBe(1);
        expect(callCount).toBe(1);
      }
    });
  });

  describe("constraint error handling", () => {
    it("catches exception inside constraint function and turns it into constraint_error issue", async () => {
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: "json",
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({ title: "Quest 1", level: 5 }),
        }),
      });

      const throwingConstraint = (_obj: unknown, params?: Record<string, unknown>) => {
        // Explicitly throw TypeError if level is accessed on null/undefined
        const p = params as { sub: { level: number } };
        return p.sub.level > 0 ? null : null;
      };

      const generator = defineGenerator({
        schema: z.object({ title: z.string(), level: z.number() }),
        constraints: [throwingConstraint],
        model: mockModel,
        maxRepairs: 0,
      });

      try {
        await generator.generate();
        expect.fail("Should have thrown GenerationError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(GenerationError);
        const genErr = err as GenerationError;
        expect(genErr.errors[0]?.rule).toBe("constraint_error");
        expect(genErr.errors[0]?.path).toBe("(root)");
      }
    });
  });

  describe("temperature option", () => {
    it("passes temperature to generateObject model call", async () => {
      let lastTemperature: number | undefined;
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: "json",
        doGenerate: async (options) => {
          lastTemperature = options.temperature;
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 20 },
            text: JSON.stringify({ title: "Quest 1", level: 5 }),
          };
        },
      });

      const generator = defineGenerator({
        schema: z.object({ title: z.string(), level: z.number() }),
        model: mockModel,
        temperature: 0.8,
      });

      await generator.generate();
      expect(lastTemperature).toBe(0.8);

      await generator.generate({}, { temperature: 0.2 });
      expect(lastTemperature).toBe(0.2);
    });
  });
});
