/**
 * RFC 9457 problem details (`application/problem+json`). Device errors keep their stable `code`;
 * HTTP-level errors (bad request, auth, routing) get codes of their own.
 */
import {
  type Cp750ErrorCode,
  type Forbidden,
  type InvalidValue,
  isCp750Error,
  type UnknownParameter,
  type WriteRejected,
} from "@cp750/device";
import type { ParamValue } from "@cp750/manifests";

export type HttpErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL";

export type ProblemCode = Cp750ErrorCode | HttpErrorCode;

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: ProblemCode;
  /** `FORBIDDEN`: why the operation was refused. */
  reason?: string;
  /** The param the error is about (canonical name when known). */
  param?: string;
  /** `WRITE_REJECTED`: the value that was sent. */
  requested?: ParamValue;
  /** `WRITE_REJECTED`: the value the unit reports it now holds. */
  actual?: ParamValue;
  /** `WRITE_REJECTED`: the raw reply value. */
  raw?: string;
  /** `INVALID_VALUE` / `BAD_REQUEST`: validation messages. */
  errors?: string[];
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export const PROBLEMS: Record<ProblemCode, { status: number; title: string }> = {
  BAD_REQUEST: { status: 400, title: "Bad request" },
  INVALID_VALUE: { status: 400, title: "Invalid value" },
  UNAUTHORIZED: { status: 401, title: "Unauthorized" },
  FORBIDDEN: { status: 403, title: "Forbidden" },
  NOT_FOUND: { status: 404, title: "Not found" },
  UNKNOWN_PARAMETER: { status: 404, title: "Unknown parameter" },
  METHOD_NOT_ALLOWED: { status: 405, title: "Method not allowed" },
  WRITE_REJECTED: { status: 422, title: "Write rejected by the device" },
  INTERNAL: { status: 500, title: "Internal server error" },
  NOT_CONNECTED: { status: 503, title: "Not connected to the CP750" },
  TIMEOUT: { status: 504, title: "The CP750 did not answer" },
};

/** `urn:cp750:problem:<code>`: a stable, non-dereferenceable problem type URI. */
export function problemType(code: ProblemCode): string {
  return `urn:cp750:problem:${code.toLowerCase().replaceAll("_", "-")}`;
}

export function problem(
  code: ProblemCode,
  detail: string,
  extra: Omit<Partial<Problem>, "type" | "title" | "status" | "code" | "detail"> = {},
): Problem {
  const { status, title } = PROBLEMS[code];
  return { type: problemType(code), title, status, detail, code, ...extra };
}

/** Maps any thrown value to a problem. Unknown errors become a generic 500 (details are logged, not sent). */
export function problemFromError(error: unknown): Problem {
  if (!isCp750Error(error)) {
    return problem("INTERNAL", "Unexpected server error");
  }
  // Dispatch on the stable `code`, not the class, so errors from another copy of the module map too.
  switch (error.code) {
    case "FORBIDDEN": {
      const e = error as Forbidden;
      return problem("FORBIDDEN", e.message, { reason: e.reason, param: e.param });
    }
    case "WRITE_REJECTED": {
      const e = error as WriteRejected;
      return problem("WRITE_REJECTED", e.message, {
        param: e.param,
        requested: e.requested,
        actual: e.actual,
        raw: e.raw,
      });
    }
    case "INVALID_VALUE": {
      const e = error as InvalidValue;
      return problem("INVALID_VALUE", e.message, { param: e.param, errors: [...e.errors] });
    }
    case "UNKNOWN_PARAMETER": {
      const e = error as UnknownParameter;
      return problem("UNKNOWN_PARAMETER", e.message, { param: e.param });
    }
    default:
      return problem(error.code, error.message);
  }
}

export function problemResponse(body: Problem, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { "content-type": PROBLEM_CONTENT_TYPE, ...headers },
  });
}
