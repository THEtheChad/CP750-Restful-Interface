import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import metaSchemaJson from "../schema/cp750-manifest.v1.schema.json" with { type: "json" };
import type { Manifest, ParamSpec, ValueSchema } from "./types.ts";

/** The manifest meta-schema (JSON Schema 2020-12). */
export const MANIFEST_META_SCHEMA: Readonly<Record<string, unknown>> = metaSchemaJson;

export interface ManifestIssue {
  /** JSON Pointer into the manifest, e.g. `/params/cp750.sys.fader/value`. */
  path: string;
  message: string;
}

export type ManifestValidation =
  | { ok: true; manifest: Manifest }
  | { ok: false; issues: ManifestIssue[] };

export class ManifestValidationError extends Error {
  readonly code = "INVALID_MANIFEST";
  readonly label: string;
  readonly issues: readonly ManifestIssue[];

  constructor(label: string, issues: readonly ManifestIssue[]) {
    const detail = issues.map((i) => `  ${i.path || "/"}: ${i.message}`).join("\n");
    super(`Invalid CP750 manifest (${label}):\n${detail}`);
    this.name = "ManifestValidationError";
    this.label = label;
    this.issues = issues;
  }
}

const metaAjv = new Ajv2020({ allErrors: true, strict: true });
const validateMeta = metaAjv.compile<Manifest>(metaSchemaJson);

/** Ajv for the per-param value schemas. `x-format` is an annotation, not an assertion. */
const valueAjv = new Ajv2020({ allErrors: true, strict: true });
valueAjv.addKeyword({ keyword: "x-format", schemaType: "string" });

const compiledValueSchemas = new WeakMap<ValueSchema, ValidateFunction>();

function pointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function toIssues(errors: ErrorObject[] | null | undefined): ManifestIssue[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath,
    message: `${e.message ?? "is invalid"}${e.params && Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : ""}`,
  }));
}

/** Compiles (and caches) the Ajv validator for a value schema. Throws if it does not compile. */
export function compileValueSchema(schema: ValueSchema): ValidateFunction {
  let compiled = compiledValueSchemas.get(schema);
  if (!compiled) {
    compiled = valueAjv.compile(schema);
    compiledValueSchemas.set(schema, compiled);
  }
  return compiled;
}

function semanticIssues(manifest: Manifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const owners = new Map<string, string>();
  for (const name of Object.keys(manifest.params)) owners.set(name, name);

  for (const [name, spec] of Object.entries(manifest.params)) {
    const at = `/params/${pointerSegment(name)}`;
    try {
      compileValueSchema(spec.value);
    } catch (error) {
      issues.push({ path: `${at}/value`, message: `does not compile: ${String(error)}` });
    }
    const v = spec.value;
    if (v.type === "integer" && v.minimum !== undefined && v.maximum !== undefined) {
      if (v.minimum > v.maximum) issues.push({ path: `${at}/value`, message: "minimum > maximum" });
    }
    if (name.startsWith("cp750.internal.") && spec.internal !== true) {
      issues.push({ path: `${at}/internal`, message: "cp750.internal.* params must be internal" });
    }
    for (const alias of spec.aliases ?? []) {
      const owner = owners.get(alias);
      if (owner && owner !== name) {
        issues.push({
          path: `${at}/aliases`,
          message: `alias "${alias}" is already used by ${owner}`,
        });
      }
      owners.set(alias, name);
    }
  }
  return issues;
}

/**
 * Validates untrusted data as a manifest: the meta-schema, then checks the meta-schema cannot
 * express (every value schema compiles, min <= max, `internal` flags, alias collisions).
 */
export function validateManifest(data: unknown): ManifestValidation {
  if (!validateMeta(data)) return { ok: false, issues: toIssues(validateMeta.errors) };
  const issues = semanticIssues(data);
  return issues.length ? { ok: false, issues } : { ok: true, manifest: data };
}

/** Like `validateManifest`, but throws `ManifestValidationError`. `label` names the source. */
export function assertManifest(data: unknown, label = "manifest"): Manifest {
  const result = validateManifest(data);
  if (!result.ok) throw new ManifestValidationError(label, result.issues);
  return result.manifest;
}

export type ValueValidation = { ok: true } | { ok: false; errors: string[] };

/** Validates a JSON value against a param's value schema. */
export function validateValue(param: Pick<ParamSpec, "value">, value: unknown): ValueValidation {
  const validate = compileValueSchema(param.value);
  if (validate(value)) return { ok: true };
  const errors = (validate.errors ?? []).map((e) => {
    const allowed = e.keyword === "enum" ? ` (${JSON.stringify(e.params.allowedValues)})` : "";
    return `value ${e.message ?? "is invalid"}${allowed}`;
  });
  return { ok: false, errors };
}
