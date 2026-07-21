import { generateObject, NoObjectGeneratedError, type LanguageModel } from "ai";
import { z } from "zod";
import { getByPath, validateConstraints } from "./constraints.js";
import { buildPrompt } from "./prompt.js";
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
    const pathStr = issue.path.join(".");
    const { value } = getByPath(rawObject, pathStr);
    return {
      path: pathStr,
      rule: issue.code,
      currentValue: value,
      allowed: issue.message,
    };
  });
}

export interface DefineGeneratorOptions<T extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: T;
  constraints?: Constraint<z.infer<T>>[];
  examples?: unknown[];
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

    const prompt = buildPrompt({
      schema: this.options.schema,
      examples: this.options.examples,
      params,
      avoidNames: opts?.avoidNames,
      systemPrompt: this.options.systemPrompt,
    });

    try {
      const result = await generateObject({
        model: activeModel,
        schema: this.options.schema,
        prompt,
      });

      const parsed = this.options.schema.safeParse(result.object);
      if (!parsed.success) {
        const issues = convertZodErrorToIssues(parsed.error, result.object);
        throw new GenerationError({
          attempts: 1,
          lastObject: result.object,
          errors: issues,
        });
      }

      const constraintIssues = validateConstraints(
        parsed.data,
        (this.options.constraints as Constraint[]) || [],
        params
      );

      if (constraintIssues.length > 0) {
        throw new GenerationError({
          attempts: 1,
          lastObject: parsed.data,
          errors: constraintIssues,
        });
      }

      return parsed.data;
    } catch (err: unknown) {
      if (err instanceof GenerationError) {
        throw err;
      }

      if (NoObjectGeneratedError.isInstance(err)) {
        let rawObj: unknown = undefined;
        if (err.text) {
          try {
            rawObj = JSON.parse(err.text);
          } catch {
            rawObj = err.text;
          }
        }

        let issues: ValidationIssue[] = [];

        const cause = err.cause;
        if (cause instanceof z.ZodError) {
          issues = convertZodErrorToIssues(cause, rawObj);
        } else if (
          cause &&
          typeof cause === "object" &&
          "issues" in cause &&
          Array.isArray((cause as { issues: unknown[] }).issues)
        ) {
          issues = convertZodErrorToIssues(cause as z.ZodError, rawObj);
        } else if (
          cause &&
          typeof cause === "object" &&
          "cause" in cause &&
          (cause as { cause: unknown }).cause instanceof z.ZodError
        ) {
          issues = convertZodErrorToIssues(
            (cause as { cause: z.ZodError }).cause,
            rawObj
          );
        } else {
          issues = [
            {
              path: "",
              rule: "no_object_generated",
              currentValue: rawObj,
              allowed: err.message,
            },
          ];
        }

        throw new GenerationError({
          attempts: 1,
          lastObject: rawObj,
          errors: issues,
        });
      }

      if (
        err &&
        typeof err === "object" &&
        "cause" in err &&
        (err as { cause: unknown }).cause instanceof z.ZodError
      ) {
        const zodErr = (err as { cause: z.ZodError }).cause;
        const rawObj =
          "value" in err
            ? (err as { value: unknown }).value
            : "text" in err
              ? (err as { text: unknown }).text
              : undefined;
        const issues = convertZodErrorToIssues(zodErr, rawObj);
        throw new GenerationError({
          attempts: 1,
          lastObject: rawObj,
          errors: issues,
        });
      }

      throw err;
    }
  }
}

export function defineGenerator<T extends z.ZodTypeAny>(
  options: DefineGeneratorOptions<T>
): Generator<T> {
  return new Generator<T>(options);
}
