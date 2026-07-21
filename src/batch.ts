import pLimit from "p-limit";
import { z } from "zod";
import { Generator, GenerateOptions, GenerationError } from "./generator.js";
import { ValidationIssue } from "./types.js";

export interface GenerateBatchOptions {
  count: number;
  concurrency?: number;
  params?: Record<string, unknown>;
  onProgress?: (progress: { completed: number; total: number }) => void;
  model?: GenerateOptions["model"];
}

export interface BatchResult<T> {
  items: T[];
  failures: { index: number; errors: ValidationIssue[] }[];
}

export async function generateBatch<T>(
  generator: Generator<z.ZodTypeAny>,
  options: GenerateBatchOptions
): Promise<BatchResult<T>> {
  const { count, concurrency = 3, params, onProgress, model } = options;

  if (count <= 0) {
    if (onProgress) {
      onProgress({ completed: 0, total: 0 });
    }
    return { items: [], failures: [] };
  }

  const limit = pLimit(concurrency);
  const items: T[] = [];
  const failures: { index: number; errors: ValidationIssue[] }[] = [];
  const generatedNames: string[] = [];

  let completedCount = 0;

  const tasks = Array.from({ length: count }, (_, index) => {
    return limit(async () => {
      const avoidNames = [...generatedNames];

      try {
        const item = (await generator.generate(params, {
          avoidNames,
          model,
        })) as T;

        items.push(item);

        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const nameOrTitle = record.name ?? record.title;
          if (typeof nameOrTitle === "string" && nameOrTitle.trim() !== "") {
            generatedNames.push(nameOrTitle);
          }
        }
      } catch (err: unknown) {
        if (err instanceof GenerationError) {
          failures.push({
            index,
            errors: err.errors,
          });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          failures.push({
            index,
            errors: [
              {
                path: "",
                rule: "generation_failed",
                currentValue: undefined,
                allowed: message,
              },
            ],
          });
        }
      } finally {
        completedCount++;
        if (onProgress) {
          onProgress({ completed: completedCount, total: count });
        }
      }
    });
  });

  await Promise.all(tasks);

  return { items, failures };
}
