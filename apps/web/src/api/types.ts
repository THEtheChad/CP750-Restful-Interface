/** Friendly aliases for the generated OpenAPI types (`bun run gen`). */
import type { components } from "./generated/schema.ts";

type Schemas = components["schemas"];

export type Device = Schemas["Device"];
export type ConnectionState = Device["connection"];
export type ManifestInfo = Schemas["ManifestInfo"];
export type Commands = Schemas["Commands"];
export type Command = Schemas["Command"];
export type ValueSchema = NonNullable<Schemas["ValueSchema"]>;
export type ParamValue = Schemas["ParamValue"];
export type ParamReading = Schemas["ParamReading"];
export type ActionResult = Schemas["ActionResult"];
export type Problem = Schemas["Problem"];
export type ProblemCode = Problem["code"];
export type BlockedReason = NonNullable<Problem["reason"]>;
export type Operation = Command["operations"][number];
export type SessionEvent = Schemas["SessionEvent"];
export type ParamEvent = Schemas["ParamEvent"];
export type ConnectionEvent = Schemas["ConnectionEvent"];
export type DeviceEvent = Schemas["DeviceEvent"];
