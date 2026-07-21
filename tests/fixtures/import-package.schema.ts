import { z } from "zod";
import { range } from "quest-forge";

export const schema = z.object({
  title: z.string(),
  level: z.number(),
});

export default {
  schema,
  constraints: [range("level", [1, 10])],
};
