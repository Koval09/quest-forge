import { describe, expect, it } from "vitest";
import {
  custom,
  oneOf,
  range,
  validateConstraints,
} from "../src/index.js";

describe("Constraints module", () => {
  describe("range constraint", () => {
    it("validates static range bounds correctly", () => {
      const constraint = range("level", [1, 10]);

      expect(validateConstraints({ level: 5 }, [constraint])).toEqual([]);

      const below = validateConstraints({ level: 0 }, [constraint]);
      expect(below).toEqual([
        {
          path: "level",
          rule: "range",
          currentValue: 0,
          allowed: [1, 10],
        },
      ]);

      const above = validateConstraints({ level: 11 }, [constraint]);
      expect(above).toEqual([
        {
          path: "level",
          rule: "range",
          currentValue: 11,
          allowed: [1, 10],
        },
      ]);
    });

    it("supports dynamic range bounds dependent on params", () => {
      const constraint = range("reward.gold", (_obj, params) => {
        const level = (params?.level as number) || 1;
        return [level * 10, level * 50];
      });

      const params = { level: 3 }; // bounds: [30, 150]

      expect(
        validateConstraints({ reward: { gold: 100 } }, [constraint], params)
      ).toEqual([]);

      const invalid = validateConstraints(
        { reward: { gold: 200 } },
        [constraint],
        params
      );
      expect(invalid).toEqual([
        {
          path: "reward.gold",
          rule: "range",
          currentValue: 200,
          allowed: [30, 150],
        },
      ]);
    });
  });

  describe("oneOf constraint", () => {
    it("validates static oneOf values", () => {
      const constraint = oneOf("rarity", ["common", "rare", "legendary"]);

      expect(validateConstraints({ rarity: "rare" }, [constraint])).toEqual([]);

      const invalid = validateConstraints({ rarity: "epic" }, [constraint]);
      expect(invalid).toEqual([
        {
          path: "rarity",
          rule: "oneOf",
          currentValue: "epic",
          allowed: ["common", "rare", "legendary"],
        },
      ]);
    });

    it("supports dynamic oneOf values dependent on params", () => {
      const constraint = oneOf("type", (_obj, params) => {
        return (params?.allowedTypes as string[]) || ["normal"];
      });

      const params = { allowedTypes: ["fire", "water"] };

      expect(
        validateConstraints({ type: "fire" }, [constraint], params)
      ).toEqual([]);

      const invalid = validateConstraints({ type: "earth" }, [constraint], params);
      expect(invalid).toEqual([
        {
          path: "type",
          rule: "oneOf",
          currentValue: "earth",
          allowed: ["fire", "water"],
        },
      ]);
    });
  });

  describe("custom constraint", () => {
    it("passes when returning null and fails when returning string message", () => {
      const constraint = custom((obj: unknown) => {
        const quest = obj as { reqLevel?: number; recLevel?: number };
        if ((quest.recLevel ?? 0) < (quest.reqLevel ?? 0)) {
          return "Recommended level cannot be lower than required level";
        }
        return null;
      });

      expect(
        validateConstraints({ reqLevel: 5, recLevel: 10 }, [constraint])
      ).toEqual([]);

      const invalidObj = { reqLevel: 10, recLevel: 5 };
      const invalid = validateConstraints(invalidObj, [constraint]);
      expect(invalid).toEqual([
        {
          path: "(root)",
          rule: "custom",
          currentValue: invalidObj,
          allowed: "Recommended level cannot be lower than required level",
        },
      ]);
    });
  });

  describe("nested paths and missing paths", () => {
    it("correctly traverses deeply nested paths", () => {
      const constraint = range("player.stats.health", [50, 100]);

      expect(
        validateConstraints({ player: { stats: { health: 75 } } }, [
          constraint,
        ])
      ).toEqual([]);
    });

    it("returns path_not_found when nested path does not exist", () => {
      const constraint = range("reward.gold", [10, 50]);

      const issues = validateConstraints({ reward: {} }, [constraint]);
      expect(issues).toEqual([
        {
          path: "reward.gold",
          rule: "path_not_found",
          currentValue: undefined,
          allowed: [10, 50],
        },
      ]);
    });
  });

  describe("multiple constraint violations", () => {
    it("collects ALL issues without stopping early", () => {
      const c1 = range("level", [1, 10]);
      const c2 = oneOf("rarity", ["common", "rare"]);
      const c3 = range("reward.gold", [100, 500]);

      const target = {
        level: 99,
        rarity: "godlike",
        // reward.gold is missing
      };

      const issues = validateConstraints(target, [c1, c2, c3]);

      expect(issues).toHaveLength(3);
      expect(issues).toEqual([
        {
          path: "level",
          rule: "range",
          currentValue: 99,
          allowed: [1, 10],
        },
        {
          path: "rarity",
          rule: "oneOf",
          currentValue: "godlike",
          allowed: ["common", "rare"],
        },
        {
          path: "reward.gold",
          rule: "path_not_found",
          currentValue: undefined,
          allowed: [100, 500],
        },
      ]);
    });
  });
});
