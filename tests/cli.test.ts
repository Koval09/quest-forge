import { InvalidArgumentError } from "commander";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectParams, parsePositiveInteger } from "../src/cli/generate.js";
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

  describe("loadSchemaFile (jiti)", () => {
    it("successfully loads valid schema module from fixture", async () => {
      const fixturePath = path.join(__dirname, "fixtures", "valid.schema.ts");
      const loaded = await loadSchemaFile(fixturePath);

      expect(loaded.schema).toBeDefined();
      expect(typeof loaded.schema.safeParse).toBe("function");
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
});
