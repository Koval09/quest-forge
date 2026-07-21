import type { LanguageModel } from "ai";
import { Command, InvalidArgumentError } from "commander";
import fs from "node:fs";
import path from "node:path";
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

export interface CLIGenerateOptions {
  schema: string;
  count: number;
  out?: string;
  model?: string;
  param?: Record<string, unknown>;
  concurrency: number;
}

export async function runGenerateAction(
  options: CLIGenerateOptions,
  overrideModel?: LanguageModel
): Promise<void> {
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
    });

    const batchResult = await generator.generateBatch({
      count: options.count,
      concurrency: options.concurrency,
      params: options.param,
      onProgress: ({ completed, total }) => {
        process.stderr.write(`Generated ${completed}/${total}...\r`);
      },
    });

    process.stderr.write("\n");

    const jsonOutput = JSON.stringify(batchResult.items, null, 2);

    if (options.out) {
      const absoluteOutPath = path.resolve(process.cwd(), options.out);
      fs.mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
      fs.writeFileSync(absoluteOutPath, jsonOutput, "utf-8");
      process.stderr.write(`Wrote ${batchResult.items.length} items to ${options.out}\n`);
    } else {
      process.stdout.write(jsonOutput + "\n");
    }

    if (batchResult.failures.length > 0) {
      process.stderr.write(
        `Warning: ${batchResult.failures.length} of ${options.count} items failed generation.\n`
      );
      for (const failure of batchResult.failures) {
        process.stderr.write(
          ` - Item #${failure.index}: ${JSON.stringify(failure.errors)}\n`
        );
      }
    }

    if (batchResult.items.length === 0 && options.count > 0) {
      process.stderr.write("Error: All batch items failed generation.\n");
      process.exitCode = 1;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
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
    .action(async (options: CLIGenerateOptions) => {
      await runGenerateAction(options);
    });

  return cmd;
}
