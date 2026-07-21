import { z } from "zod";

export default {
  schema: z.object({
    name: z.string(),
    level: z.number(),
  }),
};
