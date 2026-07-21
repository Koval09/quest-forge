import { describe, expect, it } from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import { z } from "zod";
import { defineGenerator, range } from "../src/index.js";

describe("Batch generation module", () => {
  it("generates a batch of 5 items successfully", async () => {
    let callCount = 0;
    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => {
        callCount++;
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({ name: `Quest ${callCount}`, level: 5 }),
        };
      },
    });

    const generator = defineGenerator({
      schema: z.object({
        name: z.string(),
        level: z.number(),
      }),
      model: mockModel,
    });

    const result = await generator.generateBatch({ count: 5, concurrency: 2 });

    expect(result.items).toHaveLength(5);
    expect(result.failures).toHaveLength(0);
    expect(result.items[0]?.name).toBe("Quest 1");
    expect(result.items[4]?.name).toBe("Quest 5");
  });

  it("accumulates avoidNames between completed tasks", async () => {
    const avoidNamesSeen: string[][] = [];

    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async (options) => {
        const promptStr =
          typeof options.prompt === "string"
            ? options.prompt
            : JSON.stringify(options.prompt);
        const match = promptStr.match(
          /Already generated, do NOT repeat or closely imitate: ([^"\r\n\\]+)/
        );
        const avoidList =
          match && match[1] ? match[1].split(", ").map((s) => s.trim()) : [];
        avoidNamesSeen.push(avoidList);

        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({
            name: `Item ${avoidNamesSeen.length}`,
            level: 5,
          }),
        };
      },
    });

    const generator = defineGenerator({
      schema: z.object({
        name: z.string(),
        level: z.number(),
      }),
      model: mockModel,
    });

    await generator.generateBatch({ count: 3, concurrency: 1 });

    expect(avoidNamesSeen).toHaveLength(3);
    // Task 1 sees empty avoid list
    expect(avoidNamesSeen[0]).toEqual([]);
    // Task 2 sees ["Item 1"]
    expect(avoidNamesSeen[1]).toEqual(["Item 1"]);
    // Task 3 sees ["Item 1", "Item 2"]
    expect(avoidNamesSeen[2]).toEqual(["Item 1", "Item 2"]);
  });

  it("handles failures gracefully (4 succeed, 1 fails)", async () => {
    let callCount = 0;
    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => {
        callCount++;
        // 3rd task generates invalid level 99 (range [1, 10])
        const level = callCount === 3 ? 99 : 5;
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({ title: `Quest ${callCount}`, level }),
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
      maxRepairs: 0, // Fail immediately on invalid level
    });

    const result = await generator.generateBatch({ count: 5, concurrency: 1 });

    expect(result.items).toHaveLength(4);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.index).toBe(2); // 3rd task (0-indexed 2)
    expect(result.failures[0]?.errors[0]?.rule).toBe("range");
  });

  it("guarantees final onProgress call when completed === total", async () => {
    const progressCalls: { completed: number; total: number }[] = [];

    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 20 },
        text: JSON.stringify({ name: "Quest", level: 5 }),
      }),
    });

    const generator = defineGenerator({
      schema: z.object({ name: z.string(), level: z.number() }),
      model: mockModel,
    });

    await generator.generateBatch({
      count: 4,
      concurrency: 2,
      onProgress: (p) => progressCalls.push(p),
    });

    expect(progressCalls).toHaveLength(4);
    const finalCall = progressCalls[progressCalls.length - 1];
    expect(finalCall).toEqual({ completed: 4, total: 4 });
  });

  it("strictly respects concurrency limit during execution", async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;

    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => {
        activeTasks++;
        if (activeTasks > maxActiveTasks) {
          maxActiveTasks = activeTasks;
        }
        // Artificial async delay to allow concurrent execution overlap
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeTasks--;

        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({ name: "Quest", level: 5 }),
        };
      },
    });

    const generator = defineGenerator({
      schema: z.object({ name: z.string(), level: z.number() }),
      model: mockModel,
    });

    await generator.generateBatch({
      count: 6,
      concurrency: 2,
    });

    expect(maxActiveTasks).toBeLessThanOrEqual(2);
    expect(maxActiveTasks).toBe(2);
  });

  it("retries once when a duplicate name is produced, and marks failure if still duplicate", async () => {
    let callCount = 0;
    const promptsReceived: string[] = [];
    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async (options) => {
        callCount++;
        promptsReceived.push(JSON.stringify(options.prompt));
        // Always returns "Same Name"
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({ name: "Same Name", level: 5 }),
        };
      },
    });

    const generator = defineGenerator({
      schema: z.object({ name: z.string(), level: z.number() }),
      model: mockModel,
    });

    const result = await generator.generateBatch({ count: 2, concurrency: 1 });

    // Item 1 succeeds with "Same Name"
    // Item 2 produces "Same Name", retries once with "Same Name", still duplicate -> recorded in failures
    expect(callCount).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.errors[0]?.rule).toBe("duplicate");

    // The retry prompt (3rd call) must contain explicit duplicate warning with duplicate name
    const retryPrompt = promptsReceived[2];
    expect(retryPrompt).toContain(
      "The title/name 'Same Name' is already taken. Choose a completely different name and setting."
    );
  });

  it("preserves item order by task index even if tasks complete out of order", async () => {
    let callCount = 0;
    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => {
        callCount++;
        const current = callCount;
        if (current === 1) {
          // First task takes longer
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({ name: `Item ${current}`, level: current }),
        };
      },
    });

    const generator = defineGenerator({
      schema: z.object({ name: z.string(), level: z.number() }),
      model: mockModel,
    });

    const result = await generator.generateBatch({ count: 2, concurrency: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.name).toBe("Item 1");
    expect(result.items[1]?.name).toBe("Item 2");
  });

  it("handles onProgress callback throwing an exception gracefully without crashing batch", async () => {
    let callCount = 0;
    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => {
        callCount++;
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({ name: `Quest ${callCount}`, level: 5 }),
        };
      },
    });

    const generator = defineGenerator({
      schema: z.object({ name: z.string(), level: z.number() }),
      model: mockModel,
    });

    const result = await generator.generateBatch({
      count: 3,
      concurrency: 2,
      onProgress: () => {
        throw new Error("Progress callback crashed!");
      },
    });

    expect(result.items).toHaveLength(3);
  });

  it("validates concurrency parameter and throws error for non-integer or < 1", async () => {
    const generator = defineGenerator({
      schema: z.object({ name: z.string() }),
    });

    await expect(generator.generateBatch({ count: 5, concurrency: 0 })).rejects.toThrow(
      'Option "concurrency" must be an integer >= 1'
    );

    await expect(generator.generateBatch({ count: 5, concurrency: -1 })).rejects.toThrow(
      'Option "concurrency" must be an integer >= 1'
    );

    await expect(generator.generateBatch({ count: 5, concurrency: 1.5 })).rejects.toThrow(
      'Option "concurrency" must be an integer >= 1'
    );
  });

  it("handles a large batch of count: 1000 items efficiently", async () => {
    let callCount = 0;
    const mockModel = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => {
        callCount++;
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 5, completionTokens: 10 },
          text: JSON.stringify({ name: `Item ${callCount}`, level: 1 }),
        };
      },
    });

    const generator = defineGenerator({
      schema: z.object({ name: z.string(), level: z.number() }),
      model: mockModel,
    });

    const result = await generator.generateBatch({ count: 1000, concurrency: 50 });

    expect(result.items).toHaveLength(1000);
    expect(result.failures).toHaveLength(0);
  });
});
