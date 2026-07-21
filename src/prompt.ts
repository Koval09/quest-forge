import { z } from "zod";
import { ValidationIssue } from "./types.js";

export interface BuildPromptOptions {
  schema: z.ZodTypeAny;
  examples?: unknown[];
  params?: Record<string, unknown>;
  avoidNames?: string[];
  systemPrompt?: string;
  isBatch?: boolean;
}

export function describeZodType(type: z.ZodTypeAny, indentLevel = 0): string {
  const indent = "  ".repeat(indentLevel);
  let current: z.ZodTypeAny = type;
  let isOptional = false;

  while (current) {
    const typeName = current._def.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodNullable") {
      isOptional = true;
      current = current._def.innerType;
    } else if (typeName === "ZodDefault") {
      current = current._def.innerType;
    } else {
      break;
    }
  }

  const description =
    type.description || current.description || current._def.description;
  const descSuffix = description ? ` - ${description}` : "";
  const optSuffix = isOptional ? " (optional)" : "";

  const typeName = current._def.typeName;

  if (typeName === "ZodObject") {
    const shape = (current as z.ZodObject<z.ZodRawShape>).shape;
    const lines: string[] = [];
    if (indentLevel > 0 && descSuffix) {
      lines.push(`${descSuffix}${optSuffix}`);
    }
    for (const [key, value] of Object.entries(shape)) {
      const childDesc = describeZodType(value as z.ZodTypeAny, indentLevel + 1);
      lines.push(`${indent}  - ${key}: ${childDesc.trimStart()}`);
    }
    return lines.join("\n");
  }

  let typeLabel = "unknown";
  if (typeName === "ZodString") typeLabel = "string";
  else if (typeName === "ZodNumber") typeLabel = "number";
  else if (typeName === "ZodBoolean") typeLabel = "boolean";
  else if (typeName === "ZodEnum") {
    const values = (current as z.ZodEnum<[string, ...string[]]>)._def.values;
    typeLabel = `enum(${values.join(" | ")})`;
  } else if (typeName === "ZodArray") {
    const itemType = (current as z.ZodArray<z.ZodTypeAny>)._def.type;
    typeLabel = `array of ${describeZodType(itemType, 0).split(" - ")[0]}`;
  }

  return `${typeLabel}${optSuffix}${descSuffix}`;
}

export function formatSchemaFields(schema: z.ZodTypeAny): string {
  if (schema._def.typeName === "ZodObject") {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const lines: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const fieldDesc = describeZodType(value as z.ZodTypeAny, 0);
      lines.push(`- ${key}: ${fieldDesc}`);
    }
    return lines.length > 0 ? lines.join("\n") : "(empty schema)";
  }
  return describeZodType(schema, 0);
}

export function buildPrompt(options: BuildPromptOptions): string {
  const parts: string[] = [];

  if (options.systemPrompt) {
    parts.push(options.systemPrompt.trim());
  }

  parts.push("Field instructions:\n" + formatSchemaFields(options.schema));

  if (options.examples && options.examples.length > 0) {
    parts.push(
      `Examples of valid objects:\n${JSON.stringify(options.examples, null, 2)}`
    );
  }

  if (options.params && Object.keys(options.params).length > 0) {
    const formattedParams = Object.entries(options.params)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    parts.push(`Generation parameters: ${formattedParams}`);
  }

  if (options.avoidNames && options.avoidNames.length > 0) {
    parts.push(
      `Already generated, do NOT repeat or closely imitate: ${options.avoidNames.join(", ")}`
    );
  }

  if (options.isBatch || (options.avoidNames && options.avoidNames.length > 0)) {
    parts.push(
      "Variety requirements:\n" +
        "- Vary tone, description structure, names, and reward values WITHIN allowed ranges.\n" +
        "- Avoid repetitive or templated opening phrases; ensure every item description starts differently.\n" +
        "- Do not give identical reward values or stats across generated items."
    );
  }

  return parts.join("\n\n");
}

export interface BuildRepairPromptOptions extends BuildPromptOptions {
  previousObject: unknown;
  issues: ValidationIssue[];
}

export function buildRepairPrompt(options: BuildRepairPromptOptions): string {
  const basePrompt = buildPrompt(options);
  const parts: string[] = [basePrompt];

  parts.push("The previously generated object was invalid.");

  parts.push(`Previous object:\n${JSON.stringify(options.previousObject, null, 2)}`);

  parts.push("Validation issues to fix:");
  const issueLines = options.issues.map((issue) => {
    if (issue.rule === "duplicate") {
      return `- The title/name '${issue.currentValue}' is already taken. Choose a completely different name and setting.`;
    }
    const allowedStr =
      issue.allowed === undefined ? "undefined" : JSON.stringify(issue.allowed);
    const valueStr =
      issue.currentValue === undefined
        ? "undefined"
        : JSON.stringify(issue.currentValue);

    return `- Field "${issue.path || "(root)"}" violated rule "${issue.rule}": current value is ${valueStr}, allowed: ${allowedStr}`;
  });

  parts.push(issueLines.join("\n"));
  parts.push(
    "Please fix ONLY the invalid fields listed above and preserve all other valid fields. Return a valid object."
  );

  return parts.join("\n\n");
}
