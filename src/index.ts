export const VERSION = "0.1.0";

export {
  defineGenerator,
  Generator,
  GenerationError,
  type DefineGeneratorOptions,
  type GenerateOptions,
} from "./generator.js";

export {
  generateBatch,
  type GenerateBatchOptions,
  type BatchResult,
} from "./batch.js";

export {
  range,
  oneOf,
  custom,
  validateConstraints,
  type RangeBounds,
  type OneOfValues,
  type CustomCheckFn,
} from "./constraints.js";

export type { Constraint, ValidationIssue } from "./types.js";
export type { BuildPromptOptions, BuildRepairPromptOptions } from "./prompt.js";
