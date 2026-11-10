/**
 * RFC 9457 problem details from the gateway, plus the two failures the gateway cannot describe
 * itself: a network error (the gateway is unreachable) and a non-problem error body.
 */
import type { Problem, ProblemCode } from "./types.ts";

/** A problem as the client sees it: the gateway's codes plus `NETWORK`. */
export type ClientProblem = Omit<Problem, "code"> & { code: ProblemCode | "NETWORK" };

export class ApiError extends Error {
  readonly problem: ClientProblem;

  constructor(problem: ClientProblem) {
    super(problem.detail || problem.title);
    this.name = "ApiError";
    this.problem = problem;
  }

  get code(): ClientProblem["code"] {
    return this.problem.code;
  }

  get status(): number {
    return this.problem.status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Turns an error response (parsed body, or text) into a problem, whatever the body looks like. */
export function toProblem(status: number, statusText: string, body: unknown): ClientProblem {
  if (isRecord(body) && typeof body.code === "string" && typeof body.title === "string") {
    return {
      type: typeof body.type === "string" ? body.type : "about:blank",
      status: typeof body.status === "number" ? body.status : status,
      detail: typeof body.detail === "string" ? body.detail : body.title,
      ...body,
    } as ClientProblem;
  }
  const title = statusText || `HTTP ${status}`;
  const detail = typeof body === "string" && body.trim() !== "" ? body.trim().slice(0, 300) : title;
  const code: ProblemCode =
    status === 401
      ? "UNAUTHORIZED"
      : status === 403
        ? "FORBIDDEN"
        : status === 404
          ? "NOT_FOUND"
          : status === 503
            ? "NOT_CONNECTED"
            : status === 504
              ? "TIMEOUT"
              : status >= 500
                ? "INTERNAL"
                : "BAD_REQUEST";
  return { type: "about:blank", title, status, detail, code };
}

export function networkProblem(error: unknown): ClientProblem {
  const message = error instanceof Error ? error.message : String(error);
  return {
    type: "urn:cp750:client:network",
    title: "Can't reach the gateway",
    status: 0,
    detail: message || "The request did not reach the CP750 gateway.",
    code: "NETWORK",
  };
}

export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(networkProblem(error));
}
