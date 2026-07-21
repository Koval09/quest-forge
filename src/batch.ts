import pLimit from "p-limit";
import { GenerateOptions, GenerationError } from "./generator.js";
import { ValidationIssue } from "./types.js";

export interface GenerateBatchOptions {
  count: number;
  concurrency?: number;
  params?: Record<string, unknown>;
  onProgress?: (progress: { completed: number; total: number }) => void;
  model?: GenerateOptions["model"];
  temperature?: number;
}

export interface BatchResult<T> {
  items: T[];
  failures: { index: number; errors: ValidationIssue[] }[];
}

function getItemName(item: unknown): string | null {
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const nameOrTitle = record.name ?? record.title;
    if (typeof nameOrTitle === "string" && nameOrTitle.trim() !== "") {
      return nameOrTitle.trim();
    }
  }
  return null;
}

export interface BatchGeneratorInterface<T = unknown> {
  generate(
    params?: Record<string, unknown>,
    opts?: GenerateOptions
  ): Promise<T>;
}

export async function generateBatch<T>(
  generator: BatchGeneratorInterface<T>,
  options: GenerateBatchOptions
): Promise<BatchResult<T>> {
  const { count, concurrency = 3, params, onProgress, model, temperature } = options;

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `Option "concurrency" must be an integer >= 1, received ${concurrency}.`
    );
  }

  if (count <= 0) {
    if (onProgress) {
      try {
        onProgress({ completed: 0, total: 0 });
      } catch {
        // Ignore onProgress errors
      }
    }
    return { items: [], failures: [] };
  }

  const limit = pLimit(concurrency);
  const orderedItems: (T | undefined)[] = new Array(count);
  const failures: { index: number; errors: ValidationIssue[] }[] = [];
  const acceptedNames = new Set<string>();

  let completedCount = 0;
  const isBatch = count > 1;

  const tasks = Array.from({ length: count }, (_, index) => {
    return limit(async () => {
      try {
        let item = (await generator.generate(params, {
          avoidNames: Array.from(acceptedNames),
          model,
          temperature,
          isBatch,
        })) as T;

        let nameOrTitle = getItemName(item);

        // Deduplication on output: if name collides, retry once with updated avoidNames & duplicateName prompt
        if (nameOrTitle && acceptedNames.has(nameOrTitle)) {
          item = (await generator.generate(params, {
            avoidNames: Array.from(acceptedNames),
            model,
            temperature,
            isBatch,
            duplicateName: nameOrTitle,
          })) as T;
          nameOrTitle = getItemName(item);
        }

        if (nameOrTitle && acceptedNames.has(nameOrTitle)) {
          failures.push({
            index,
            errors: [
              {
                path: "(root)",
                rule: "duplicate",
                currentValue: nameOrTitle,
                allowed: "Unique item name/title",
              },
            ],
          });
        } else {
          if (nameOrTitle) {
            acceptedNames.add(nameOrTitle);
          }
          orderedItems[index] = item;
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
                path: "(root)",
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
          try {
            onProgress({ completed: completedCount, total: count });
          } catch {
            // Ignore onProgress errors to prevent batch crash
          }
        }
      }
    });
  });

  await Promise.all(tasks);

  const items: T[] = orderedItems.filter((x): x is T => x !== undefined);

  return { items, failures };
}
