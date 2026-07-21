import { generateObject, NoObjectGeneratedError, type LanguageModel } from "ai";
import { z } from "zod";
import { generateBatch, type GenerateBatchOptions, type BatchResult } from "./batch.js";
import { getByPath, validateConstraints } from "./constraints.js";
import { buildPrompt, buildRepairPrompt } from "./prompt.js";
import { Constraint, ValidationIssue } from "./types.js";

export class GenerationError extends Error {
  public readonly attempts: number;
  public readonly lastObject: unknown;
  public readonly errors: ValidationIssue[];

  constructor(params: {
    attempts: number;
    lastObject: unknown;
    errors: ValidationIssue[];
  }) {
    const errorSummary = params.errors
      .map(
        (e) =>
          `[${e.path || "root"}] (${e.rule}): current=${JSON.stringify(e.currentValue)}, allowed=${JSON.stringify(e.allowed)}`
      )
      .join("; ");

    super(
      `Generation failed after ${params.attempts} attempt(s) with ${params.errors.length} error(s): ${errorSummary}`
    );
    this.name = "GenerationError";
    this.attempts = params.attempts;
    this.lastObject = params.lastObject;
    this.errors = params.errors;

    Object.setPrototypeOf(this, GenerationError.prototype);
  }
}

export function convertZodErrorToIssues(
  zodError: z.ZodError,
  rawObject: unknown
): ValidationIssue[] {
  return zodError.issues.map((issue) => {
    const pathStr = issue.path.length === 0 ? "(root)" : issue.path.join(".");
    const { value } = getByPath(rawObject, pathStr === "(root)" ? "" : pathStr);

    let allowed: unknown = issue.message;
    if (issue.code === "invalid_type") {
      allowed = (issue as z.ZodInvalidTypeIssue).expected;
    } else if (issue.code === "too_small") {
      const smallIssue = issue as z.ZodTooSmallIssue;
      allowed = { min: smallIssue.minimum, inclusive: smallIssue.inclusive };
    } else if (issue.code === "too_big") {
      const bigIssue = issue as z.ZodTooBigIssue;
      allowed = { max: bigIssue.maximum, inclusive: bigIssue.inclusive };
    } else if (issue.code === "invalid_enum_value") {
      allowed = (issue as z.ZodInvalidEnumValueIssue).options;
    }

    return {
      path: pathStr,
      rule: issue.code,
      currentValue: value,
      allowed,
    };
  });
}

export interface DefineGeneratorOptions<T extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: T;
  constraints?: Constraint<z.infer<T>>[];
  examples?: Array<Partial<z.infer<T>>>;
  model?: LanguageModel;
  systemPrompt?: string;
  maxRepairs?: number;
}

export interface GenerateOptions {
  model?: LanguageModel;
  avoidNames?: string[];
}

export class Generator<T extends z.ZodTypeAny = z.ZodTypeAny> {
  constructor(public readonly options: DefineGeneratorOptions<T>) {}

  async generate(
    params?: Record<string, unknown>,
    opts?: GenerateOptions
  ): Promise<z.infer<T>> {
    const activeModel = opts?.model ?? this.options.model;
    if (!activeModel) {
      throw new Error(
        "No LanguageModel provided. Pass a model to defineGenerator({ model }) or generator.generate(params, { model })."
      );
    }

    const safeParams = params ?? {};
    const maxRepairs = this.options.maxRepairs ?? 3;

    let currentPrompt = buildPrompt({
      schema: this.options.schema,
      examples: this.options.examples,
      params: safeParams,
      avoidNames: opts?.avoidNames,
      systemPrompt: this.options.systemPrompt,
    });

    let totalAttempts = 0;
    let lastObject: unknown = undefined;
    let lastIssues: ValidationIssue[] = [];

    for (let repairAttempt = 0; repairAttempt <= maxRepairs; repairAttempt++) {
      totalAttempts++;

      try {
        const result = await generateObject({
          model: activeModel,
          schema: this.options.schema,
          prompt: currentPrompt,
        });

        lastObject = result.object;

        const parsed = this.options.schema.safeParse(result.object);
        if (!parsed.success) {
          lastIssues = convertZodErrorToIssues(parsed.error, result.object);
        } else {
          const constraintIssues = validateConstraints(
            parsed.data,
            (this.options.constraints as Constraint[]) || [],
            safeParams
          );

          if (constraintIssues.length === 0) {
            return parsed.data;
          }

          lastIssues = constraintIssues;
        }
      } catch (err: unknown) {
        if (err instanceof GenerationError) {
          throw err;
        }

        if (NoObjectGeneratedError.isInstance(err)) {
          if (err.text) {
            try {
              lastObject = JSON.parse(err.text);
            } catch {
              lastObject = err.text;
            }
          } else {
            lastObject = undefined;
          }

          const cause = err.cause;
          if (cause instanceof z.ZodError) {
            lastIssues = convertZodErrorToIssues(cause, lastObject);
          } else if (
            cause &&
            typeof cause === "object" &&
            "issues" in cause &&
            Array.isArray((cause as { issues: unknown[] }).issues)
          ) {
            lastIssues = convertZodErrorToIssues(cause as z.ZodError, lastObject);
          } else if (
            cause &&
            typeof cause === "object" &&
            "cause" in cause &&
            (cause as { cause: unknown }).cause instanceof z.ZodError
          ) {
            lastIssues = convertZodErrorToIssues(
              (cause as { cause: z.ZodError }).cause,
              lastObject
            );
          } else {
            lastIssues = [
              {
                path: "(root)",
                rule: "no_object_generated",
                currentValue: lastObject,
                allowed: err.message,
              },
            ];
          }
        } else if (
          err &&
          typeof err === "object" &&
          "cause" in err &&
          (err as { cause: unknown }).cause instanceof z.ZodError
        ) {
          const zodErr = (err as { cause: z.ZodError }).cause;
          lastObject =
            "value" in err
              ? (err as { value: unknown }).value
              : "text" in err
                ? (err as { text: unknown }).text
                : undefined;
          lastIssues = convertZodErrorToIssues(zodErr, lastObject);
        } else {
          throw err;
        }
      }

      if (repairAttempt < maxRepairs) {
        currentPrompt = buildRepairPrompt({
          schema: this.options.schema,
          examples: this.options.examples,
          params: safeParams,
          avoidNames: opts?.avoidNames,
          systemPrompt: this.options.systemPrompt,
          previousObject: lastObject,
          issues: lastIssues,
        });
      }
    }

    throw new GenerationError({
      attempts: totalAttempts,
      lastObject,
      errors: lastIssues,
    });
  }

  async generateBatch(
    options: GenerateBatchOptions
  ): Promise<BatchResult<z.infer<T>>> {
    return generateBatch<z.infer<T>>(this, options);
  }
}

export function defineGenerator<T extends z.ZodTypeAny>(
  options: DefineGeneratorOptions<T>
): Generator<T> {
  return new Generator<T>(options);
}
