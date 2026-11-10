/**
 * Picks the input control for a param from its value JSON Schema (`GET /api/commands`). The
 * manifest meta-schema only allows integers (`minimum`/`maximum`/`enum`) and strings
 * (`enum`/`maxLength`/`x-format`), so this mapping is total.
 */
import type { ValueSchema } from "../api/types.ts";

/** Integer ranges up to this span get a slider next to the number input. */
export const SLIDER_MAX_SPAN = 400;

export type ControlSpec =
  | { kind: "switch" }
  | { kind: "select"; options: (string | number)[]; valueType: "integer" | "string" }
  | { kind: "range"; min: number; max: number }
  | { kind: "number"; min?: number; max?: number }
  | { kind: "text"; maxLength?: number; format?: string }
  | { kind: "none" };

export function controlFor(schema: ValueSchema | null | undefined): ControlSpec {
  if (!schema) return { kind: "none" };
  if (schema.type === "integer") {
    if (schema.enum && schema.enum.length > 0) {
      const values = [...schema.enum].map(Number).sort((a, b) => a - b);
      if (values.length === 2 && values[0] === 0 && values[1] === 1) return { kind: "switch" };
      return { kind: "select", options: schema.enum, valueType: "integer" };
    }
    const { minimum: min, maximum: max } = schema;
    if (min !== undefined && max !== undefined && max - min <= SLIDER_MAX_SPAN) {
      return { kind: "range", min, max };
    }
    return {
      kind: "number",
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
  }
  if (schema.enum && schema.enum.length > 0) {
    return { kind: "select", options: schema.enum, valueType: "string" };
  }
  return {
    kind: "text",
    ...(schema.maxLength !== undefined ? { maxLength: schema.maxLength } : {}),
    ...(schema["x-format"] ? { format: schema["x-format"] } : {}),
  };
}

export type Parsed = { ok: true; value: string | number } | { ok: false; error: string };

/** Parses and validates what the operator typed, against the schema. */
export function parseInput(schema: ValueSchema, input: string): Parsed {
  if (schema.type === "integer") {
    const text = input.trim().replace(/^−/, "-");
    if (!/^-?\d+$/.test(text)) return { ok: false, error: "Enter a whole number" };
    const value = Number(text);
    if (schema.minimum !== undefined && value < schema.minimum) {
      return { ok: false, error: `Must be ${schema.minimum} or more` };
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return { ok: false, error: `Must be ${schema.maximum} or less` };
    }
    if (schema.enum && !schema.enum.map(Number).includes(value)) {
      return { ok: false, error: `Must be one of ${schema.enum.join(", ")}` };
    }
    return { ok: true, value };
  }
  if (schema.maxLength !== undefined && input.length > schema.maxLength) {
    return { ok: false, error: `At most ${schema.maxLength} characters` };
  }
  if (schema.enum && !schema.enum.map(String).includes(input)) {
    return { ok: false, error: `Must be one of ${schema.enum.join(", ")}` };
  }
  return { ok: true, value: input };
}

/** The namespace of `cp750.<namespace>.<rest>`; `other` for anything else. */
export function namespaceOf(name: string): string {
  const parts = name.split(".");
  return parts.length >= 3 && parts[0] === "cp750" ? (parts[1] as string) : "other";
}
