import { z } from "zod";
import { oneOf, range } from "../src/index.js";

export const itemSchema = z.object({
  name: z.string().describe("Full name of the fantasy item"),
  category: z
    .enum(["weapon", "armor", "potion", "accessory", "relic"])
    .describe("Category of the item"),
  rarity: z
    .enum(["common", "uncommon", "rare", "epic", "legendary"])
    .describe("Rarity tier of the item"),
  value: z.number().describe("Base vendor value in gold coins"),
  powerRating: z.number().describe("Numeric combat or utility rating"),
});

export default {
  schema: itemSchema,
  constraints: [
    range("value", (_obj, params) => {
      const level = (params?.level as number) || 1;
      return [level * 15, level * 100];
    }),
    range("powerRating", (_obj, params) => {
      const level = (params?.level as number) || 1;
      return [level * 5, level * 25];
    }),
    oneOf("rarity", (_obj, params) => {
      const minLevel = (params?.level as number) || 1;
      if (minLevel >= 10) return ["rare", "epic", "legendary"];
      return ["common", "uncommon", "rare"];
    }),
  ],
  examples: [
    {
      name: "Flameforged Broadsword",
      category: "weapon",
      rarity: "rare",
      value: 350,
      powerRating: 85,
    },
  ],
};
