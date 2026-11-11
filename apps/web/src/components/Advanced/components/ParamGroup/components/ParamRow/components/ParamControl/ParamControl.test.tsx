import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ParamValue, ValueSchema } from "../../../../../../../../api/types.ts";
import { ParamControl } from "./ParamControl.tsx";

function setup(
  schema: ValueSchema | null,
  value: ParamValue | undefined,
  disabled = false,
  pending = false,
) {
  const onCommit = mock((_: ParamValue) => Promise.resolve());
  render(
    <>
      <span id="name">cp750.sys.x</span>
      <ParamControl
        schema={schema}
        value={value}
        disabled={disabled}
        pending={pending}
        labelledBy="name"
        onCommit={onCommit}
      />
    </>,
  );
  return onCommit;
}

describe("ParamControl renders the control the schema calls for", () => {
  test("0/1 enum → a switch that commits on click", () => {
    const onCommit = setup({ type: "integer", enum: [0, 1] }, 0);
    const toggle = screen.getByRole("switch", { name: "cp750.sys.x" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onCommit).toHaveBeenCalledWith(1);
  });

  test("a switch ignores clicks while a write is pending", () => {
    const onCommit = setup({ type: "integer", enum: [0, 1] }, 0, false, true);
    const toggle = screen.getByRole("switch", { name: "cp750.sys.x" });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(toggle);
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("Set and Undo are named after the param", () => {
    setup({ type: "string", maxLength: 16 }, "booth-1");
    expect(screen.getByRole("button", { name: "Set cp750.sys.x" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "booth-2" } });
    expect(screen.getByRole("button", { name: "Undo cp750.sys.x" })).toBeTruthy();
  });

  test("string enum → a select; the change is only sent with Set", async () => {
    const onCommit = setup({ type: "string", enum: ["off", "on", "n_a"] }, "off");
    const select = screen.getByRole("combobox", { name: "cp750.sys.x" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["off", "on", "n_a"]);
    fireEvent.change(select, { target: { value: "on" } });
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Set cp750.sys.x" })));
    expect(onCommit).toHaveBeenCalledWith("on");
  });

  test("integer enum values are sent as numbers", async () => {
    const onCommit = setup({ type: "integer", enum: [1, 2, 3] }, 1);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "3" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Set cp750.sys.x" })));
    expect(onCommit).toHaveBeenCalledWith(3);
  });

  test("small integer range → slider plus number input", async () => {
    const onCommit = setup({ type: "integer", minimum: -60, maximum: 60 }, 0);
    const slider = screen.getByRole("slider", { name: "cp750.sys.x" }) as HTMLInputElement;
    expect(slider.min).toBe("-60");
    expect(slider.max).toBe("60");
    const number = screen.getByRole("spinbutton", { name: "cp750.sys.x (number)" });
    fireEvent.change(number, { target: { value: "-12" } });
    await act(async () => fireEvent.submit(number.closest("form") as HTMLFormElement));
    expect(onCommit).toHaveBeenCalledWith(-12);
  });

  test("large range → number input only, validated before sending", () => {
    const onCommit = setup({ type: "integer", minimum: 200, maximum: 5000 }, 500);
    expect(screen.queryByRole("slider")).toBeNull();
    const number = screen.getByRole("spinbutton");
    fireEvent.change(number, { target: { value: "100" } });
    expect(screen.getByText("Must be 200 or more")).toBeTruthy();
    expect(number.getAttribute("aria-invalid")).toBe("true");
    expect(
      (screen.getByRole("button", { name: "Set cp750.sys.x" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.submit(number.closest("form") as HTMLFormElement);
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("string → text field; Escape discards the draft", () => {
    setup({ type: "string", maxLength: 16 }, "booth-1");
    const field = screen.getByRole("textbox", { name: "cp750.sys.x" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "booth-2" } });
    expect(field.value).toBe("booth-2");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.value).toBe("booth-1");
  });

  test("disabled controls can't be used", () => {
    setup({ type: "integer", enum: [0, 1] }, 1, true);
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  });
});
