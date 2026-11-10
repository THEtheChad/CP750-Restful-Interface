import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ApiError } from "../../api/problem.ts";
import { formatFader } from "../../lib/fader.ts";
import { ProblemMessage } from "./ProblemMessage.tsx";

describe("ProblemMessage", () => {
  test("renders WRITE_REJECTED as what the processor kept", () => {
    const error = new ApiError({
      type: "urn:cp750:problem:write-rejected",
      title: "Write rejected",
      status: 422,
      detail: "cp750.sys.fader: requested 75, unit kept 65",
      code: "WRITE_REJECTED",
      requested: 75,
      actual: 65,
    });
    render(<ProblemMessage error={error} formatValue={(v) => formatFader(Number(v))} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The processor kept 6.5");
    expect(alert.textContent).toContain("It did not accept 7.5.");
    expect(alert.textContent).toContain("WRITE_REJECTED");
  });

  test("explains a forbidden reason in plain words, not JSON", () => {
    const error = new ApiError({
      type: "urn:cp750:problem:forbidden",
      title: "Forbidden",
      status: 403,
      detail: "write cp750.sys.mute: full-tier",
      code: "FORBIDDEN",
      reason: "full-tier",
    });
    render(<ProblemMessage error={error} />);
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toContain("CP750_ALLOW_FULL=1");
    expect(text).not.toContain("{");
  });

  test("renders nothing without an error", () => {
    const { container } = render(<ProblemMessage error={null} />);
    expect(container.innerHTML).toBe("");
  });
});
