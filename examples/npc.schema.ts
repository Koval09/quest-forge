import { z } from "zod";
import { custom, oneOf, range } from "../src/index.js";

export const npcSchema = z.object({
  name: z.string().describe("Unique full name of the NPC"),
  role: z
    .enum(["blacksmith", "merchant", "guard", "quest_giver", "villager", "wizard"])
    .describe("Primary occupation or role in town"),
  faction: z.string().describe("Faction or guild affiliation"),
  disposition: z
    .enum(["friendly", "neutral", "hostile"])
    .describe("Initial attitude towards the player"),
  reputationRequired: z
    .number()
    .describe("Minimum faction reputation needed to interact"),
});

export default {
  schema: npcSchema,
  constraints: [
    range("reputationRequired", [0, 100]),
    oneOf("disposition", (_obj, params) => {
      if (params?.faction === "bandits") return ["hostile", "neutral"];
      return ["friendly", "neutral"];
    }),
    custom((obj) => {
      const npc = obj as { role?: string; faction?: string };
      if (npc.role === "wizard" && npc.faction === "bandits") {
        return "Bandit wizards are not permitted; wizards must belong to a mage guild or be independent.";
      }
      return null;
    }),
  ],
  examples: [
    {
      name: "Gideon Thistlewood",
      role: "quest_giver",
      faction: "Town Guard",
      disposition: "friendly",
      reputationRequired: 10,
    },
  ],
};
