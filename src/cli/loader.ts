import { createJiti } from "jiti";
import path from "node:path";
import { z } from "zod";
import { Constraint } from "../types.js";

export interface LoadedSchemaModule {
  schema: z.ZodTypeAny;
  constraints?: Constraint[];
  examples?: unknown[];
}

export async function loadSchemaFile(filePath: string): Promise<LoadedSchemaModule> {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const parentUrl =
    typeof import.meta !== "undefined" && import.meta.url
      ? import.meta.url
      : __filename;
  const jiti = createJiti(parentUrl);

  let moduleExports: unknown;
  try {
    moduleExports = await jiti.import(absolutePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load schema file "${filePath}": ${msg}`);
  }

  if (!moduleExports || typeof moduleExports !== "object") {
    throw new Error(`Schema file "${filePath}" must export an object.`);
  }

  const defaultExport = (moduleExports as { default?: unknown }).default;
  if (!defaultExport || typeof defaultExport !== "object") {
    throw new Error(`Schema file "${filePath}" must have a default export.`);
  }

  const { schema, constraints, examples } = defaultExport as {
    schema?: unknown;
    constraints?: Constraint[];
    examples?: unknown[];
  };

  if (
    !schema ||
    typeof schema !== "object" ||
    typeof (schema as { safeParse?: unknown }).safeParse !== "function"
  ) {
    throw new Error(
      `Schema file "${filePath}" default export must contain a valid Zod 'schema' property.`
    );
  }

  return {
    schema: schema as z.ZodTypeAny,
    constraints,
    examples,
  };
}
