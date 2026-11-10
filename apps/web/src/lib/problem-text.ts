/** Turns problem details into operator-facing text. */
import type { ClientProblem } from "../api/problem.ts";
import type { ParamValue } from "../api/types.ts";
import { reasonText } from "./reasons.ts";

export interface ProblemText {
  title: string;
  detail: string | null;
  code: string;
}

export function describeProblem(
  problem: ClientProblem,
  formatValue: (value: ParamValue) => string = String,
): ProblemText {
  const code = problem.code;
  const detail = (text: string | undefined | null) =>
    text && text !== problem.title ? text : null;
  switch (code) {
    case "WRITE_REJECTED": {
      const kept = problem.actual !== undefined ? formatValue(problem.actual) : "its value";
      const asked = problem.requested !== undefined ? formatValue(problem.requested) : null;
      return {
        title: `The processor kept ${kept}`,
        detail: asked ? `It did not accept ${asked}.` : "It did not accept the new value.",
        code,
      };
    }
    case "FORBIDDEN":
      return {
        title: "Not allowed",
        detail: problem.reason ? reasonText(problem.reason, "write") : detail(problem.detail),
        code,
      };
    case "UNAUTHORIZED":
      return {
        title:
          problem.detail === "Invalid token" ? "The API token was rejected" : "API token needed",
        detail: "Enter the gateway's API token (Token, at the top) and try again.",
        code,
      };
    case "INVALID_VALUE":
    case "BAD_REQUEST":
      return {
        title: problem.title,
        detail: problem.errors?.length ? problem.errors.join("; ") : detail(problem.detail),
        code,
      };
    case "NOT_CONNECTED":
      return { title: "The processor is offline", detail: detail(problem.detail), code };
    case "TIMEOUT":
      return { title: "The processor didn't answer in time", detail: detail(problem.detail), code };
    case "NETWORK":
      return {
        title: "Can't reach the gateway",
        detail: "Check that the CP750 gateway is running and this device is on its network.",
        code,
      };
    default:
      return { title: problem.title, detail: detail(problem.detail), code };
  }
}
