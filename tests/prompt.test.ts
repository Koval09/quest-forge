import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildPrompt, buildRepairPrompt, ValidationIssue } from "../src/index.js";

describe("Prompt builder module", () => {
  describe("buildPrompt", () => {
    it("includes zod field descriptions and types in prompt", () => {
      const schema = z.object({
        name: z.string().describe("The name of the quest"),
        level: z.number().describe("Required player level"),
      });

      const prompt = buildPrompt({ schema });

      expect(prompt).toContain("Field instructions:");
      expect(prompt).toContain("- name: string - The name of the quest");
      expect(prompt).toContain("- level: number - Required player level");
    });

    it("formats nested schemas with proper indentation", () => {
      const schema = z.object({
        title: z.string().describe("Quest title"),
        reward: z.object({
          gold: z.number().describe("Gold amount"),
        }),
      });

      const prompt = buildPrompt({ schema });

      expect(prompt).toContain("- title: string - Quest title");
      expect(prompt).toContain("- reward:");
      expect(prompt).toContain("  - gold: number - Gold amount");
    });

    it("serializes examples into JSON under Examples section", () => {
      const schema = z.object({
        title: z.string(),
      });
      const examples = [{ title: "Forest Adventure" }, { title: "Dragon Slayer" }];

      const prompt = buildPrompt({ schema, examples });

      expect(prompt).toContain("Examples of valid objects:");
      expect(prompt).toContain('"title": "Forest Adventure"');
      expect(prompt).toContain('"title": "Dragon Slayer"');
    });

    it("inserts generation parameters formatted as key=value", () => {
      const schema = z.object({ title: z.string() });
      const params = { theme: "forest", level: 3 };

      const prompt = buildPrompt({ schema, params });

      expect(prompt).toContain("Generation parameters: theme=forest, level=3");
    });

    it("inserts avoidNames with instructions not to repeat", () => {
      const schema = z.object({ title: z.string() });
      const avoidNames = ["Goblin Hunt", "Orc Attack"];

      const prompt = buildPrompt({ schema, avoidNames });

      expect(prompt).toContain(
        "Already generated, do NOT repeat or closely imitate: Goblin Hunt, Orc Attack"
      );
    });

    it("prepends systemPrompt if provided", () => {
      const schema = z.object({ title: z.string() });
      const systemPrompt = "You are a dark fantasy quest generator.";

      const prompt = buildPrompt({ schema, systemPrompt });

      expect(prompt.startsWith("You are a dark fantasy quest generator.")).toBe(
        true
      );
    });
  });

  describe("buildRepairPrompt", () => {
    it("generates repair prompt containing path, rule, currentValue, and allowed range for each issue", () => {
      const previousObject = {
        name: "Test Quest",
        level: 0,
        rarity: "godlike",
      };

      const issues: ValidationIssue[] = [
        {
          path: "level",
          rule: "range",
          currentValue: 0,
          allowed: [1, 10],
        },
        {
          path: "rarity",
          rule: "oneOf",
          currentValue: "godlike",
          allowed: ["common", "rare"],
        },
      ];

      const repairPrompt = buildRepairPrompt({ previousObject, issues });

      expect(repairPrompt).toContain("The previously generated object was invalid.");
      expect(repairPrompt).toContain('"name": "Test Quest"');
      expect(repairPrompt).toContain(
        '- Field "level" violated rule "range": current value is 0, allowed: [1,10]'
      );
      expect(repairPrompt).toContain(
        '- Field "rarity" violated rule "oneOf": current value is "godlike", allowed: ["common","rare"]'
      );
      expect(repairPrompt).toContain(
        "Please fix ONLY the invalid fields listed above and preserve all other valid fields."
      );
    });
  });
});
