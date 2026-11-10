/** Zod schemas for the HTTP API. They drive request validation and the generated OpenAPI document. */
import { z } from "@hono/zod-openapi";
import { PROBLEMS, type ProblemCode, problemType } from "./problem.ts";

const PARAM_UNITS = ["fader", "ms", "us", "dB_tenths", "feet_or_meters"] as const;
const CONNECTION = ["idle", "connecting", "connected", "reconnecting", "closed"] as const;
const OPERATIONS = ["read", "write", "action"] as const;
const BLOCK_REASONS = [
  "full-tier",
  "internal",
  "access",
  "read-only-mode",
  "unverified",
  "confirmation-required",
  "raw-only",
  "raw-command",
  "unavailable",
] as const;

export const ParamValueSchema = z.union([z.number(), z.string()]).openapi("ParamValue", {
  description:
    "A parameter value: an integer or a string, depending on the param. `GET /api/commands` returns each param's JSON Schema.",
  example: 70,
});

export const ParamNameSchema = z
  .string()
  .min(1)
  .max(128)
  .openapi({
    param: { name: "name", in: "path" },
    description:
      "Parameter name or alias, case-insensitive. The set depends on the firmware; discover it with `GET /api/commands`.",
    example: "cp750.sys.fader",
  });

export const ParamReadingSchema = z
  .object({
    name: z.string().openapi({ description: "Canonical name", example: "cp750.sys.fader" }),
    value: ParamValueSchema,
    raw: z.string().openapi({ description: "Value as the unit sent it", example: "70" }),
    unit: z.enum(PARAM_UNITS).optional().openapi({ example: "fader" }),
    db: z
      .number()
      .optional()
      .openapi({ description: "Fader level in dB (only for the `fader` unit)", example: 0 }),
  })
  .openapi("ParamReading");

export const WriteRequestSchema = z
  .object({
    value: ParamValueSchema,
    confirm: z
      .boolean()
      .optional()
      .openapi({ description: "Required (`true`) for destructive params" }),
  })
  .openapi("WriteRequest", { example: { value: 70 } });

export const ActionRequestSchema = z
  .object({
    value: ParamValueSchema.optional().openapi({ description: "Defaults to 1" }),
    confirm: z
      .boolean()
      .optional()
      .openapi({ description: "Required (`true`) for destructive actions" }),
  })
  .openapi("ActionRequest", { example: { value: 5 } });

export const ActionResultSchema = z
  .object({
    name: z.string().openapi({ example: "cp750.ctrl.fader_delta" }),
    value: ParamValueSchema,
    raw: z.string().openapi({ example: "5" }),
  })
  .openapi("ActionResult");

export const HealthSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string().openapi({ example: "0.1.0" }),
  })
  .openapi("Health");

export const ManifestInfoSchema = z
  .object({
    firmware: z.string().nullable().openapi({ example: "1.2.8.3" }),
    status: z.enum(["verified", "draft"]).nullable(),
    match: z.enum(["exact", "nearest", "none"]),
    verified: z.boolean(),
  })
  .openapi("ManifestInfo");

const SessionErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .openapi("SessionError");

export const DeviceSchema = z
  .object({
    connection: z.enum(CONNECTION),
    host: z.string().openapi({ example: "192.168.1.136" }),
    port: z.number().int().openapi({ example: 61408 }),
    firmware: z.string().nullable().openapi({ example: "1.2.8.3" }),
    manifest: ManifestInfoSchema.nullable(),
    fullControl: z.boolean(),
    readOnly: z.boolean(),
    allowFull: z.boolean(),
    allowInternal: z.boolean(),
    authRequired: z.boolean().openapi({ description: "True when mutations need a Bearer token" }),
    lastError: SessionErrorSchema.nullable(),
  })
  .openapi("Device");

export const ValueSchemaSchema = z
  .object({
    type: z.enum(["integer", "string"]),
    minimum: z.number().int().optional(),
    maximum: z.number().int().optional(),
    enum: z.array(z.union([z.number(), z.string()])).optional(),
    maxLength: z.number().int().optional(),
    "x-format": z
      .enum(["route-list", "ip-setting"])
      .optional()
      .openapi({ description: "Annotation for structured strings (format unverified)" }),
  })
  .openapi("ValueSchema", {
    description:
      "JSON Schema (2020-12) of a param's value. `null` for raw names that only `help` lists.",
    example: { type: "integer", minimum: 0, maximum: 100 },
  });

export const CommandSchema = z
  .object({
    name: z.string().openapi({ example: "cp750.sys.fader" }),
    aliases: z.array(z.string()),
    source: z
      .enum(["manifest", "help"])
      .openapi({ description: "`help` names are not in the manifest and are raw read-only" }),
    availability: z.enum(["confirmed", "missing", "unchecked"]),
    operations: z
      .array(z.enum(OPERATIONS))
      .openapi({ description: "Operations allowed now (destructive ones still need confirm)" }),
    blocked: z
      .partialRecord(z.enum(OPERATIONS), z.enum(BLOCK_REASONS))
      .openapi({ description: "Why each refused operation is refused" }),
    access: z.enum(["readwrite", "readonly", "action"]).nullable(),
    tier: z.enum(["normal", "full"]).nullable(),
    unit: z.enum(PARAM_UNITS).nullable(),
    destructive: z.boolean(),
    internal: z.boolean(),
    description: z.string().nullable(),
    schema: ValueSchemaSchema.nullable(),
  })
  .openapi("Command");

export const CommandsSchema = z
  .object({
    firmware: z.string().nullable(),
    manifest: ManifestInfoSchema.nullable(),
    commands: z.array(CommandSchema),
  })
  .openapi("Commands");

export const OpenApiDocumentSchema = z
  .record(z.string(), z.unknown())
  .openapi("OpenApiDocument", { description: "This OpenAPI 3.1 document" });

const at = z
  .string()
  .openapi({ description: "ISO timestamp", example: "2026-11-10T12:00:00.000Z" });

export const ParamEventSchema = z
  .object({
    type: z.literal("param"),
    name: z.string(),
    value: ParamValueSchema,
    raw: z.string(),
    previous: ParamValueSchema.optional(),
    at,
  })
  .openapi("ParamEvent");

export const ConnectionEventSchema = z
  .object({
    type: z.literal("connection"),
    connection: z.enum(CONNECTION),
    error: SessionErrorSchema.nullable(),
    at,
  })
  .openapi("ConnectionEvent");

export const DeviceEventSchema = z
  .object({
    type: z.literal("device"),
    firmware: z.string().nullable(),
    manifest: ManifestInfoSchema.nullable(),
    at,
  })
  .openapi("DeviceEvent");

export const SessionEventSchema = z
  .discriminatedUnion("type", [ParamEventSchema, ConnectionEventSchema, DeviceEventSchema])
  .openapi("SessionEvent", {
    description:
      "The `data` of each SSE message (JSON); the SSE `event` field equals `type`. Heartbeats are SSE comments.",
  });

export const ProblemSchema = z
  .object({
    type: z.string().openapi({ example: problemType("FORBIDDEN") }),
    title: z.string().openapi({ example: "Forbidden" }),
    status: z.number().int().openapi({ example: 403 }),
    detail: z.string(),
    instance: z.string().optional(),
    code: z.enum(Object.keys(PROBLEMS) as [ProblemCode, ...ProblemCode[]]),
    reason: z.enum(BLOCK_REASONS).optional(),
    param: z.string().optional(),
    requested: ParamValueSchema.optional(),
    actual: ParamValueSchema.optional(),
    raw: z.string().optional(),
    errors: z.array(z.string()).optional(),
  })
  .openapi("Problem", { description: "RFC 9457 problem details" });

const PROBLEM_DESCRIPTIONS: Record<number, string> = {
  400: "Invalid request body or value (`BAD_REQUEST`, `INVALID_VALUE`)",
  401: "Missing or wrong Bearer token (`UNAUTHORIZED`)",
  403: "Refused by the access policy (`FORBIDDEN`, see `reason`)",
  404: "Unknown parameter (`UNKNOWN_PARAMETER`)",
  422: "The device kept a different value (`WRITE_REJECTED`, see `requested` and `actual`)",
  500: "Unexpected server error (`INTERNAL`)",
  503: "Not connected to the CP750 (`NOT_CONNECTED`)",
  504: "The CP750 did not answer in time (`TIMEOUT`)",
};

const PROBLEM_EXAMPLES: Record<number, ProblemCode> = {
  400: "INVALID_VALUE",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "UNKNOWN_PARAMETER",
  422: "WRITE_REJECTED",
  500: "INTERNAL",
  503: "NOT_CONNECTED",
  504: "TIMEOUT",
};

const EXAMPLE_EXTRAS: Partial<Record<ProblemCode, Record<string, unknown>>> = {
  INVALID_VALUE: { param: "cp750.sys.fader", errors: ["must be <= 100"] },
  FORBIDDEN: { reason: "read-only-mode", param: "cp750.sys.fader" },
  UNKNOWN_PARAMETER: { param: "cp750.sys.nope" },
  WRITE_REJECTED: { param: "cp750.sys.fader", requested: 80, actual: 70, raw: "70" },
};

/** Problem response entries for `createRoute({ responses })`. */
export function problemResponses<S extends keyof typeof PROBLEM_DESCRIPTIONS>(
  ...statuses: S[]
): Record<S, { description: string; content: Record<string, { schema: typeof ProblemSchema }> }> {
  const out = {} as Record<
    S,
    { description: string; content: Record<string, { schema: typeof ProblemSchema }> }
  >;
  for (const status of statuses) {
    const code = PROBLEM_EXAMPLES[status] as ProblemCode;
    const { title } = PROBLEMS[code];
    const example = {
      type: problemType(code),
      title,
      status,
      detail: title,
      code,
      ...EXAMPLE_EXTRAS[code],
    };
    out[status] = {
      description: PROBLEM_DESCRIPTIONS[status] as string,
      content: { "application/problem+json": { schema: ProblemSchema, example } as never },
    };
  }
  return out;
}
