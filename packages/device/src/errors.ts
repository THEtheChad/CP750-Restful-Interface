import type { ParamValue } from "@cp750/manifests";

/** Stable machine-readable error codes. The HTTP layer maps these to status codes. */
export type Cp750ErrorCode =
  | "NOT_CONNECTED"
  | "TIMEOUT"
  | "UNKNOWN_PARAMETER"
  | "WRITE_REJECTED"
  | "INVALID_VALUE"
  | "FORBIDDEN";

/** Why an operation was refused. */
export type ForbiddenReason =
  /** `full`-tier param and `allowFull` is off. */
  | "full-tier"
  /** `internal` param and `allowInternal` is off. */
  | "internal"
  /** The param's `access` does not allow the operation (e.g. write to readonly, action on readwrite). */
  | "access"
  /** The session is in read-only mode. */
  | "read-only-mode"
  /** The manifest is not verified and `help` did not confirm the param. */
  | "unverified"
  /** A destructive param was used without `confirm: true`. */
  | "confirmation-required"
  /** The name is not in the manifest (help-only, or no manifest matched): raw reads only. */
  | "raw-only"
  /** `sendRaw` was given something other than a query or a read-only single-word command. */
  | "raw-command";

export abstract class Cp750Error extends Error {
  abstract readonly code: Cp750ErrorCode;
}

export class NotConnected extends Cp750Error {
  readonly code = "NOT_CONNECTED";

  constructor(message = "Not connected to the CP750") {
    super(message);
    this.name = "NotConnected";
  }
}

export class Timeout extends Cp750Error {
  readonly code = "TIMEOUT";
  readonly timeoutMs: number;
  /** The line that was sent, if the timeout was waiting on a reply. */
  readonly command: string | undefined;

  constructor(timeoutMs: number, command?: string) {
    super(`No reply from the CP750 within ${timeoutMs} ms${command ? ` to "${command}"` : ""}`);
    this.name = "Timeout";
    this.timeoutMs = timeoutMs;
    this.command = command;
  }
}

export class UnknownParameter extends Cp750Error {
  readonly code = "UNKNOWN_PARAMETER";
  /** The name as given by the caller. */
  readonly param: string;

  constructor(param: string, detail = "is not a known parameter") {
    super(`${param} ${detail}`);
    this.name = "UnknownParameter";
    this.param = param;
  }
}

export class WriteRejected extends Cp750Error {
  readonly code = "WRITE_REJECTED";
  readonly param: string;
  readonly requested: ParamValue;
  /** The value the unit reports it now holds. */
  readonly actual: ParamValue;
  /** The raw reply value. */
  readonly raw: string;

  constructor(param: string, requested: ParamValue, actual: ParamValue, raw: string) {
    super(
      `CP750 rejected ${param} = ${JSON.stringify(requested)}; it still holds ${JSON.stringify(actual)}`,
    );
    this.name = "WriteRejected";
    this.param = param;
    this.requested = requested;
    this.actual = actual;
    this.raw = raw;
  }
}

export class InvalidValue extends Cp750Error {
  readonly code = "INVALID_VALUE";
  readonly param: string;
  readonly value: unknown;
  readonly errors: readonly string[];

  constructor(param: string, value: unknown, errors: readonly string[]) {
    super(`Invalid value for ${param}: ${errors.join("; ")}`);
    this.name = "InvalidValue";
    this.param = param;
    this.value = value;
    this.errors = errors;
  }
}

export class Forbidden extends Cp750Error {
  readonly code = "FORBIDDEN";
  /** The param or raw line the operation targeted. */
  readonly param: string;
  readonly reason: ForbiddenReason;

  constructor(param: string, reason: ForbiddenReason, message?: string) {
    super(message ?? `${param}: forbidden (${reason})`);
    this.name = "Forbidden";
    this.param = param;
    this.reason = reason;
  }
}

export function isCp750Error(error: unknown): error is Cp750Error {
  return error instanceof Cp750Error;
}
