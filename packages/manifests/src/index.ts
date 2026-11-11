export { decode, encode, ValueCodecError, valuesEqual } from "./codec.ts";
export { dbToFader, FADER_MAX, FADER_MIN, FADER_NOMINAL, faderToDb } from "./fader.ts";
export { compareFirmware, isFirmwareVersion } from "./firmware.ts";
export * from "./generated/index.ts";
export {
  builtinManifests,
  type LoadManifestsOptions,
  loadManifestDir,
  loadManifestFile,
  loadManifests,
  sortManifests,
} from "./loader.ts";
export { findParam, normalizeParamName, type ResolvedParam, resolveParamName } from "./resolve.ts";
export { type ManifestMatch, type ManifestSelection, selectManifest } from "./select.ts";
export type {
  AccessSource,
  IntegerValueSchema,
  Manifest,
  ManifestSource,
  ManifestStatus,
  ParamAccess,
  ParamSpec,
  ParamTier,
  ParamUnit,
  ParamValue,
  StringFormat,
  StringValueSchema,
  ValueSchema,
} from "./types.ts";
export {
  assertManifest,
  compileValueSchema,
  MANIFEST_META_SCHEMA,
  type ManifestIssue,
  type ManifestValidation,
  ManifestValidationError,
  type ValueValidation,
  validateManifest,
  validateValue,
} from "./validate.ts";
