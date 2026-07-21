export interface ValidationIssue {
  path: string;
  rule: string;
  currentValue: unknown;
  allowed: unknown;
}

export type Constraint<T = unknown> = (
  obj: T,
  params?: Record<string, unknown>
) => ValidationIssue | ValidationIssue[] | null;
