import type { ParamSpec, ParamValue, ValueSchema } from "./types.ts";

export class ValueCodecError extends Error {
  readonly code = "VALUE_CODEC";

  constructor(message: string) {
    super(message);
    this.name = "ValueCodecError";
  }
}

type HasValueSchema = Pick<ParamSpec, "value">;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the unit may pad replies with NULs
const NUL = /\u0000/g;
const INTEGER = /^[+-]?\d+$/;

/**
 * Encodes a JSON value as the wire string for `<param> <value>`. Integers are sent as decimal,
 * strings as-is. Rejects anything that could change the meaning of the command line: control
 * characters (CR/LF would inject a second command), empty or padded strings, and a bare `?`
 * (which would turn the set into a query). Does not check ranges or enums; use `validateValue`.
 */
export function encode(param: HasValueSchema, value: ParamValue): string {
  if (param.value.type === "integer") {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      throw new ValueCodecError(`expected an integer, got ${JSON.stringify(value)}`);
    }
    return String(value);
  }
  if (typeof value !== "string") {
    throw new ValueCodecError(`expected a string, got ${JSON.stringify(value)}`);
  }
  if (CONTROL_CHARS.test(value)) throw new ValueCodecError("value contains control characters");
  if (value.trim() === "" || value.trim() === "?") {
    throw new ValueCodecError(`value ${JSON.stringify(value)} cannot be sent as a set`);
  }
  if (value !== value.trim()) {
    throw new ValueCodecError("value has leading or trailing whitespace");
  }
  return value;
}

function normalizeBracketed(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\[\s+/g, "[").replace(/\s+\]/g, "]");
}

function canonicalString(schema: ValueSchema, text: string): string {
  if (schema.type !== "string") return text;
  if (schema["x-format"]) return normalizeBracketed(text);
  if (schema.enum) {
    const lower = text.toLowerCase();
    return schema.enum.find((member) => member.toLowerCase() === lower) ?? text;
  }
  return text;
}

/**
 * Decodes the value part of a reply (`<param> <value>`) into a JSON value. Tolerates NUL bytes,
 * surrounding whitespace and the unit's casing: enum values are mapped to the manifest's spelling,
 * and `x-format` lists have their whitespace normalised. Throws `ValueCodecError` when an integer
 * param's value is not an integer. Does not check ranges or enums; use `validateValue`.
 */
export function decode(param: HasValueSchema, wire: string): ParamValue {
  const text = wire.replace(NUL, "").trim();
  if (param.value.type === "integer") {
    if (!INTEGER.test(text)) {
      throw new ValueCodecError(`expected an integer, got ${JSON.stringify(text)}`);
    }
    return Number.parseInt(text, 10);
  }
  return canonicalString(param.value, text);
}

/**
 * Compares two values of the same param the way the unit does (case-insensitive, whitespace in
 * lists ignored). Use it to check a write's echo against the requested value.
 */
export function valuesEqual(param: HasValueSchema, a: ParamValue, b: ParamValue): boolean {
  if (param.value.type === "integer") return a === b;
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = canonicalString(param.value, a.trim()).toLowerCase();
  const right = canonicalString(param.value, b.trim()).toLowerCase();
  return left === right;
}
