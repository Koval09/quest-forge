import type { LanguageModel } from "ai";
import { Command, InvalidArgumentError } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { z } from "zod";
import { defineGenerator } from "../generator.js";
import { loadSchemaFile } from "./loader.js";
import { resolveModel } from "./model.js";

export function parsePositiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new InvalidArgumentError(
      `Option --${name} must be a positive integer >= 1, received "${value}".`
    );
  }
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new InvalidArgumentError(
      `Option --${name} must be a positive integer >= 1, received "${value}".`
    );
  }
  return parsed;
}

export function collectParams(
  value: string,
  previous: Record<string, unknown> = {}
): Record<string, unknown> {
  const eqIdx = value.indexOf("=");
  if (eqIdx === -1) {
    throw new InvalidArgumentError(
      `Invalid --param format "${value}". Expected "key=value".`
    );
  }

  const key = value.slice(0, eqIdx).trim();
  const valStr = value.slice(eqIdx + 1).trim();

  if (!key) {
    throw new InvalidArgumentError(
      `Invalid --param format "${value}". Key cannot be empty.`
    );
  }

  let parsedVal: unknown = valStr;
  if (valStr === "true") parsedVal = true;
  else if (valStr === "false") parsedVal = false;
  else if (!Number.isNaN(Number(valStr)) && valStr !== "") parsedVal = Number(valStr);

  return {
    ...previous,
    [key]: parsedVal,
  };
}

export function parseTemperature(value: string): number {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 2) {
    throw new InvalidArgumentError(
      `Option --temperature must be a number between 0 and 2, received "${value}".`
    );
  }
  return parsed;
}

export interface CLIGenerateOptions {
  schema: string;
  count: number;
  out?: string;
  json?: boolean;
  model?: string;
  param?: Record<string, unknown>;
  concurrency: number;
  temperature?: number;
}

export function getPrimaryKey(schema: z.ZodTypeAny): string | undefined {
  if (schema && "_def" in schema && schema._def.typeName === "ZodObject") {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const keys = Object.keys(shape);
    for (const key of ["name", "title"]) {
      if (keys.includes(key)) {
        let current = shape[key];
        while (
          current &&
          (current._def.typeName === "ZodOptional" ||
            current._def.typeName === "ZodNullable" ||
            current._def.typeName === "ZodDefault")
        ) {
          current = current._def.innerType;
        }
        if (current && current._def.typeName === "ZodString") {
          return key;
        }
      }
    }
    for (const [key, value] of Object.entries(shape)) {
      let current = value as z.ZodTypeAny;
      while (
        current &&
        (current._def.typeName === "ZodOptional" ||
          current._def.typeName === "ZodNullable" ||
          current._def.typeName === "ZodDefault")
      ) {
        current = current._def.innerType;
      }
      if (current && current._def.typeName === "ZodString") {
        return key;
      }
    }
  }
  return undefined;
}

export function flattenObject(
  obj: Record<string, unknown>,
  prefix = ""
): Array<[string, unknown]> {
  const result: Array<[string, unknown]> = [];
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      result.push(...flattenObject(val as Record<string, unknown>, fullKey));
    } else {
      result.push([fullKey, val]);
    }
  }
  return result;
}

export function renderCard(
  index: number,
  item: unknown,
  schema: z.ZodTypeAny,
  c: ReturnType<typeof pc.createColors>
): string {
  const lines: string[] = [];
  lines.push(c.dim("─".repeat(40)));

  const primaryKey = getPrimaryKey(schema);
  let primaryValue = "";
  if (primaryKey && item && typeof item === "object") {
    primaryValue = String((item as Record<string, unknown>)[primaryKey] ?? "");
  }

  const header = `#${index + 1}: ${primaryValue ? c.bold(primaryValue) : ""}`;
  lines.push(header);

  if (item && typeof item === "object") {
    const flatPairs = flattenObject(item as Record<string, unknown>);
    for (const [key, val] of flatPairs) {
      if (key === primaryKey) {
        continue;
      }
      let formattedVal = "";
      if (Array.isArray(val)) {
        formattedVal = JSON.stringify(val);
      } else if (val && typeof val === "object") {
        formattedVal = JSON.stringify(val);
      } else {
        formattedVal = String(val);
      }
      lines.push(`  ${c.dim(key)}: ${formattedVal}`);
    }
  }

  return lines.join("\n");
}

export async function runGenerateAction(
  options: CLIGenerateOptions,
  overrideModel?: LanguageModel
): Promise<void> {
  const c = pc.createColors(
    !!process.stdout.isTTY && !process.env.NO_COLOR
  );

  try {
    const schemaModule = await loadSchemaFile(options.schema);

    let model = overrideModel;
    if (!model && options.model) {
      model = resolveModel(options.model);
    }

    const generator = defineGenerator({
      schema: schemaModule.schema,
      constraints: schemaModule.constraints,
      examples: schemaModule.examples as unknown as Array<Partial<unknown>>,
      model,
      temperature: options.temperature,
    });

    const batchResult = await generator.generateBatch({
      count: options.count,
      concurrency: options.concurrency,
      params: options.param,
      temperature: options.temperature,
      onProgress: ({ completed, total }) => {
        process.stderr.write(`Generating ${completed}/${total}...\r`);
      },
    });

    // Clear progress indicator line in stderr
    process.stderr.write(" ".repeat(30) + "\r");

    const jsonOutput = JSON.stringify(batchResult.items, null, 2);

    if (options.out) {
      const absoluteOutPath = path.resolve(process.cwd(), options.out);
      fs.mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
      fs.writeFileSync(absoluteOutPath, jsonOutput, "utf-8");
    } else if (options.json) {
      process.stdout.write(JSON.stringify(batchResult.items) + "\n");
    } else {
      for (let i = 0; i < batchResult.items.length; i++) {
        process.stdout.write(
          renderCard(i, batchResult.items[i], schemaModule.schema, c) + "\n"
        );
      }
    }

    // Final summary to stderr
    process.stderr.write(
      `Generated ${batchResult.items.length}/${options.count} (${batchResult.failures.length} failed)\n`
    );

    for (const failure of batchResult.failures) {
      const errMessages = failure.errors
        .map((err) => {
          if (err.rule === "duplicate") {
            return `duplicate: The title/name "${err.currentValue}" is already taken.`;
          }
          return `${err.rule} error on "${err.path || "(root)"}" (value: ${JSON.stringify(err.currentValue)}, allowed: ${JSON.stringify(err.allowed)})`;
        })
        .join("; ");
      process.stderr.write(c.red(` - Item #${failure.index}: ${errMessages}\n`));
    }

    if (batchResult.items.length === 0 && options.count > 0) {
      process.exitCode = 1;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(c.red(`Error: ${msg}\n`));
    process.exitCode = 1;
  }
}

export function createGenerateCommand(): Command {
  const cmd = new Command("generate");

  cmd
    .description("Generate content batch based on a Zod schema file")
    .requiredOption("-s, --schema <path>", "Path to .ts/.js schema file")
    .option(
      "-c, --count <number>",
      "Number of items to generate",
      (val) => parsePositiveInteger(val, "count"),
      1
    )
    .option("-o, --out <path>", "Output JSON file path")
    .option("--json", "Output raw JSON to stdout")
    .option("-m, --model <provider:model>", "Model spec (e.g. openai:gpt-4o-mini)")
    .option(
      "-p, --param <key=value>",
      "Generation parameters (repeatable)",
      collectParams,
      {}
    )
    .option(
      "--concurrency <number>",
      "Batch concurrency",
      (val) => parsePositiveInteger(val, "concurrency"),
      3
    )
    .option(
      "-t, --temperature <number>",
      "Sampling temperature between 0 and 2",
      parseTemperature
    )
    .action(async (options: CLIGenerateOptions) => {
      await runGenerateAction(options);
    });

  return cmd;
}
