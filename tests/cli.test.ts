import { InvalidArgumentError } from "commander";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectParams, parsePositiveInteger, parseTemperature } from "../src/cli/generate.js";
import { loadSchemaFile } from "../src/cli/loader.js";
import { resolveModel } from "../src/cli/model.js";

describe("CLI module", () => {
  describe("collectParams", () => {
    it("parses single key=value param", () => {
      const result = collectParams("theme=forest");
      expect(result).toEqual({ theme: "forest" });
    });

    it("parses repeated params and casts numeric/boolean values", () => {
      let params = collectParams("theme=forest");
      params = collectParams("level=3", params);
      params = collectParams("hardcore=true", params);

      expect(params).toEqual({
        theme: "forest",
        level: 3,
        hardcore: true,
      });
    });

    it("throws InvalidArgumentError on invalid param format without =", () => {
      expect(() => collectParams("invalid_param")).toThrow(InvalidArgumentError);
    });
  });

  describe("parsePositiveInteger", () => {
    it("returns valid positive integers", () => {
      expect(parsePositiveInteger("1", "count")).toBe(1);
      expect(parsePositiveInteger("10", "concurrency")).toBe(10);
    });

    it("throws InvalidArgumentError on non-numeric strings ('abc')", () => {
      expect(() => parsePositiveInteger("abc", "count")).toThrow(
        InvalidArgumentError
      );
    });

    it("throws InvalidArgumentError on zero ('0')", () => {
      expect(() => parsePositiveInteger("0", "count")).toThrow(
        InvalidArgumentError
      );
    });

    it("throws InvalidArgumentError on negative numbers ('-5')", () => {
      expect(() => parsePositiveInteger("-5", "count")).toThrow(
        InvalidArgumentError
      );
    });
  });

  describe("parseTemperature", () => {
    it("parses valid numbers between 0 and 2", () => {
      expect(parseTemperature("0")).toBe(0);
      expect(parseTemperature("0.7")).toBe(0.7);
      expect(parseTemperature("1.5")).toBe(1.5);
      expect(parseTemperature("2")).toBe(2);
    });

    it("throws InvalidArgumentError for numbers < 0 or > 2 or non-numeric strings", () => {
      expect(() => parseTemperature("-0.1")).toThrow(InvalidArgumentError);
      expect(() => parseTemperature("2.1")).toThrow(InvalidArgumentError);
      expect(() => parseTemperature("abc")).toThrow(InvalidArgumentError);
    });
  });

  describe("loadSchemaFile (jiti)", () => {
    it("successfully loads valid schema module from fixture", async () => {
      const fixturePath = path.join(__dirname, "fixtures", "valid.schema.ts");
      const loaded = await loadSchemaFile(fixturePath);

      expect(loaded.schema).toBeDefined();
      expect(typeof loaded.schema.safeParse).toBe("function");
    });

    it("successfully loads schema importing from 'quest-forge' package alias", async () => {
      const fixturePath = path.join(__dirname, "fixtures", "import-package.schema.ts");
      const loaded = await loadSchemaFile(fixturePath);

      expect(loaded.schema).toBeDefined();
      expect(loaded.constraints).toHaveLength(1);
    });

    it("throws clear error on broken schema fixture missing valid Zod schema", async () => {
      const fixturePath = path.join(__dirname, "fixtures", "broken.schema.ts");

      await expect(loadSchemaFile(fixturePath)).rejects.toThrow(
        "default export must contain a valid Zod 'schema' property"
      );
    });
  });

  describe("resolveModel", () => {
    it("resolves openai and anthropic models", () => {
      const openaiModel = resolveModel("openai:gpt-4o-mini");
      expect(openaiModel).toBeDefined();
      expect(openaiModel.provider).toBe("openai.chat");

      const anthropicModel = resolveModel("anthropic:claude-3-5-sonnet-20241022");
      expect(anthropicModel).toBeDefined();
      expect(anthropicModel.provider).toBe("anthropic.messages");
    });

    it("throws error on invalid format or unsupported provider", () => {
      expect(() => resolveModel("gpt-4o-mini")).toThrow(
        'Expected "provider:model"'
      );
      expect(() => resolveModel("google:gemini-1.5-pro")).toThrow(
        'Unsupported provider "google"'
      );
    });
  });

  describe("runGenerateAction (CLI action)", () => {
    it("writes output to file when --out option is provided", async () => {
      const { MockLanguageModelV1 } = await import("ai/test");
      const fs = await import("node:fs");
      const os = await import("node:os");

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

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quest-forge-test-"));
      const outPath = path.join(tempDir, "output.json");
      const schemaPath = path.join(__dirname, "fixtures", "valid.schema.ts");

      const { runGenerateAction } = await import("../src/cli/generate.js");

      await runGenerateAction(
        {
          schema: schemaPath,
          count: 2,
          concurrency: 1,
          out: outPath,
        },
        mockModel
      );

      expect(fs.existsSync(outPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      expect(content).toHaveLength(2);
      expect(content[0].name).toBe("Quest 1");

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("outputs JSON to stdout when --out is omitted", async () => {
      const { MockLanguageModelV1 } = await import("ai/test");
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: "json",
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({ name: "Stdout Quest", level: 5 }),
        }),
      });

      const schemaPath = path.join(__dirname, "fixtures", "valid.schema.ts");
      const { runGenerateAction } = await import("../src/cli/generate.js");

      let stdoutText = "";
      const originalStdoutWrite = process.stdout.write;
      process.stdout.write = (chunk: unknown) => {
        stdoutText += String(chunk);
        return true;
      };

      try {
        await runGenerateAction(
          {
            schema: schemaPath,
            count: 1,
            concurrency: 1,
          },
          mockModel
        );
      } finally {
        process.stdout.write = originalStdoutWrite;
      }

      const parsed = JSON.parse(stdoutText);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("Stdout Quest");
    });

    it("sets process.exitCode = 1 when all batch items fail generation", async () => {
      const { MockLanguageModelV1 } = await import("ai/test");
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: "json",
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20 },
          text: JSON.stringify({ title: "Quest", level: 999 }), // fails range [1, 10] constraint
        }),
      });

      const schemaPath = path.join(__dirname, "fixtures", "import-package.schema.ts");
      const { runGenerateAction } = await import("../src/cli/generate.js");

      const originalExitCode = process.exitCode;
      process.exitCode = undefined;

      try {
        await runGenerateAction(
          {
            schema: schemaPath,
            count: 2,
            concurrency: 1,
          },
          mockModel
        );

        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = originalExitCode;
      }
    });
  });
});
