import { z } from "zod";
import { oneOf, range } from "quest-forge";

export const questSchema = z.object({
  title: z.string().describe("Descriptive title of the fantasy quest"),
  description: z.string().describe("Detailed summary of the quest objectives"),
  requiredLevel: z.number().describe("Minimum player level required to start"),
  difficulty: z
    .enum(["easy", "medium", "hard", "deadly"])
    .describe("Challenge rating of the quest"),
  reward: z.object({
    gold: z.number().describe("Amount of gold coins awarded upon completion"),
    experience: z.number().describe("Experience points awarded"),
    itemRarity: z
      .enum(["common", "uncommon", "rare", "epic", "legendary"])
      .describe("Rarity of the guaranteed reward item"),
  }),
});

export default {
  schema: questSchema,
  constraints: [
    range("requiredLevel", (_obj, params) => {
      const targetLevel = (params?.level as number) || 1;
      return [Math.max(1, targetLevel - 2), targetLevel + 2];
    }),
    range("reward.gold", (_obj, params) => {
      const level = (params?.level as number) || 1;
      return [level * 10, level * 50];
    }),
    oneOf("difficulty", (_obj, params) => {
      const theme = params?.theme as string;
      if (theme === "dark_forest") return ["medium", "hard", "deadly"];
      return ["easy", "medium", "hard"];
    }),
  ],
  examples: [
    {
      title: "The Lost Amulet of Eloria",
      description: "Retrieve the ancient silver amulet stolen by goblin raiders.",
      requiredLevel: 3,
      difficulty: "medium",
      reward: {
        gold: 120,
        experience: 450,
        itemRarity: "rare",
      },
    },
  ],
};
