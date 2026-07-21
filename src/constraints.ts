import { Constraint, ValidationIssue } from "./types.js";

export function getByPath(
  obj: unknown,
  path: string
): { exists: boolean; value: unknown } {
  if (obj === null || typeof obj !== "object") {
    return { exists: false, value: undefined };
  }

  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (
      current === null ||
      typeof current !== "object" ||
      !(part in (current as Record<string, unknown>))
    ) {
      return { exists: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[part];
  }

  return { exists: true, value: current };
}

export type RangeBounds<T = unknown> =
  | [number, number]
  | ((obj: T, params?: Record<string, unknown>) => [number, number]);

export function range<T = unknown>(path: string, bounds: RangeBounds<T>): Constraint<T> {
  return (obj: T, params?: Record<string, unknown>): ValidationIssue | null => {
    const computedBounds =
      typeof bounds === "function" ? bounds(obj, params) : bounds;

    const { exists, value } = getByPath(obj, path);

    if (!exists) {
      return {
        path,
        rule: "path_not_found",
        currentValue: undefined,
        allowed: computedBounds,
      };
    }

    if (
      typeof value !== "number" ||
      Number.isNaN(value) ||
      value < computedBounds[0] ||
      value > computedBounds[1]
    ) {
      return {
        path,
        rule: "range",
        currentValue: value,
        allowed: computedBounds,
      };
    }

    return null;
  };
}

export type OneOfValues<T = unknown> =
  | unknown[]
  | ((obj: T, params?: Record<string, unknown>) => unknown[]);

export function oneOf<T = unknown>(path: string, values: OneOfValues<T>): Constraint<T> {
  return (obj: T, params?: Record<string, unknown>): ValidationIssue | null => {
    const computedValues =
      typeof values === "function" ? values(obj, params) : values;

    const { exists, value } = getByPath(obj, path);

    if (!exists) {
      return {
        path,
        rule: "path_not_found",
        currentValue: undefined,
        allowed: computedValues,
      };
    }

    if (!computedValues.includes(value)) {
      return {
        path,
        rule: "oneOf",
        currentValue: value,
        allowed: computedValues,
      };
    }

    return null;
  };
}

export type CustomCheckFn<T = unknown> = (
  obj: T,
  params?: Record<string, unknown>
) => string | null;

export function custom<T = unknown>(fn: CustomCheckFn<T>): Constraint<T> {
  return (obj: T, params?: Record<string, unknown>): ValidationIssue | null => {
    const errorMessage = fn(obj, params);
    if (errorMessage !== null) {
      return {
        path: "(root)",
        rule: "custom",
        currentValue: obj,
        allowed: errorMessage,
      };
    }
    return null;
  };
}

export function validateConstraints(
  obj: unknown,
  constraints: Constraint[] = [],
  params?: Record<string, unknown>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const constraint of constraints) {
    try {
      const result = constraint(obj, params);
      if (result !== null) {
        if (Array.isArray(result)) {
          issues.push(...result);
        } else {
          issues.push(result);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push({
        path: "(root)",
        rule: "constraint_error",
        currentValue: obj,
        allowed: msg,
      });
    }
  }

  return issues;
}
