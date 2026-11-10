/** Types mirroring `schema/cp750-manifest.v1.schema.json`. Keep the two in sync. */

export type ManifestStatus = "verified" | "draft";
export type ParamTier = "normal" | "full";
export type ParamAccess = "readwrite" | "readonly" | "action";
export type AccessSource = "manual" | "inferred" | "observed";
export type ParamUnit = "fader" | "ms" | "us" | "dB_tenths" | "feet_or_meters";
export type StringFormat = "route-list" | "ip-setting";

export interface IntegerValueSchema {
  type: "integer";
  minimum?: number;
  maximum?: number;
  enum?: readonly number[];
}

export interface StringValueSchema {
  type: "string";
  enum?: readonly string[];
  maxLength?: number;
  "x-format"?: StringFormat;
}

/** JSON Schema (2020-12) of a parameter's JSON value, restricted to what the codec supports. */
export type ValueSchema = IntegerValueSchema | StringValueSchema;

/** A decoded parameter value: integers for integer schemas, strings otherwise. */
export type ParamValue = number | string;

export interface ParamSpec {
  tier: ParamTier;
  access: ParamAccess;
  accessSource: AccessSource;
  value: ValueSchema;
  unit?: ParamUnit;
  destructive?: boolean;
  internal?: boolean;
  aliases?: readonly string[];
  description?: string;
}

export interface ManifestSource {
  kind: "manual" | "capture";
  ref: string;
  notes?: string;
}

export interface Manifest {
  $schema?: string;
  manifestVersion: 1;
  firmware: string;
  status: ManifestStatus;
  sources: ManifestSource[];
  /** Keyed by canonical lowercase name, e.g. `cp750.sys.fader`. */
  params: Record<string, ParamSpec>;
  commands: string[];
}
