import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MUTE_VOCABULARY, ON_OFF_VOCABULARY } from "../../lib/param-function.ts";
import { ToggleButton, type ToggleButtonProps } from "./ToggleButton.tsx";

function setup(props: Partial<ToggleButtonProps> = {}) {
  const onToggle = mock((_: 0 | 1) => {});
  render(
    <>
      <span id="name">cp750.sys.x</span>
      <ToggleButton
        size="desk"
        name={{ labelledBy: "name" }}
        vocabulary={ON_OFF_VOCABULARY}
        value={0}
        pending={false}
        disabled={false}
        onToggle={onToggle}
        {...props}
      />
    </>,
  );
  return onToggle;
}

describe("ToggleButton (every 0/1 param)", () => {
  test("is named after the param, states in aria-pressed, and toggles to the other value", () => {
    const onToggle = setup();
    const toggle = screen.getByRole("button", { name: "cp750.sys.x" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.textContent).toContain("Off");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  test("ignores presses while a write is pending, and says so", () => {
    const onToggle = setup({ value: 1, pending: true });
    const toggle = screen.getByRole("button", { name: "cp750.sys.x" });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.textContent).toContain("Turning on…");
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  test("unknown is disabled and says Unknown; disabled still shows on", () => {
    setup({ value: undefined });
    const unknown = screen.getByRole("button", { name: "cp750.sys.x" }) as HTMLButtonElement;
    expect(unknown.disabled).toBe(true);
    expect(unknown.getAttribute("aria-pressed")).toBeNull();
    expect(unknown.textContent).toContain("Unknown");
  });

  test("glance mute keeps the name Mute whatever its state", () => {
    setup({
      size: "glance",
      name: { label: "Mute" },
      vocabulary: MUTE_VOCABULARY,
      value: 1,
      disabled: true,
    });
    const mute = screen.getByRole("button", { name: "Mute" });
    expect(mute.getAttribute("aria-pressed")).toBe("true");
    expect(mute.getAttribute("data-tone")).toBe("on");
    // At glance size the state word sits under the key, outside its name.
    expect(mute.parentElement?.textContent).toContain("Muted");
  });
});
