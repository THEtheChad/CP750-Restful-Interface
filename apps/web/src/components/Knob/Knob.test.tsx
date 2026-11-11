import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { Knob, type KnobProps } from "./Knob.tsx";

function setup(props: Partial<KnobProps> = {}) {
  const onChange = mock((_: number) => {});
  const onRelease = mock(() => {});
  render(
    <>
      <span id="name">cp750.sys.level_l</span>
      <Knob
        value={0}
        min={-160}
        max={160}
        disabled={false}
        gestureLimit={10}
        labelledBy="name"
        valueText="0"
        onChange={onChange}
        onRelease={onRelease}
        onCancel={() => {}}
        {...props}
      />
    </>,
  );
  return { knob: screen.getByRole("slider", { name: "cp750.sys.level_l" }), onChange, onRelease };
}

describe("Knob (bipolar trims)", () => {
  test("drag up increases, 8px per step, and one gesture moves at most the limit", () => {
    const { knob, onChange, onRelease } = setup();
    fireEvent.pointerDown(knob, { clientY: 500, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(knob, { clientY: 476, pointerId: 1, pointerType: "mouse" });
    expect(onChange).toHaveBeenLastCalledWith(3);
    // A long drag stops at +10 from where the gesture started.
    fireEvent.pointerMove(knob, { clientY: 100, pointerId: 1, pointerType: "mouse" });
    expect(onChange).toHaveBeenLastCalledWith(10);
    fireEvent.pointerUp(knob, { clientY: 100, pointerId: 1, pointerType: "mouse" });
    expect(onRelease).toHaveBeenCalled();
  });

  test("keys: arrows ±1, Page Up/Down ±10, and no Home/End jump", () => {
    const { knob, onChange } = setup({ value: 5 });
    fireEvent.keyDown(knob, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(knob, { key: "PageDown" });
    expect(onChange).toHaveBeenLastCalledWith(-5);
    onChange.mockClear();
    fireEvent.keyDown(knob, { key: "End" });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("touch: the first tap only selects it (the list keeps scrolling); then it drags", () => {
    const { knob, onChange } = setup();
    fireEvent.pointerDown(knob, { clientY: 300, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerMove(knob, { clientY: 200, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(knob, { clientY: 300, pointerId: 1, pointerType: "touch" });
    expect(onChange).not.toHaveBeenCalled();
    expect(knob.getAttribute("data-armed")).toBe("true");
    fireEvent.pointerDown(knob, { clientY: 300, pointerId: 2, pointerType: "touch" });
    fireEvent.pointerMove(knob, { clientY: 284, pointerId: 2, pointerType: "touch" });
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  test("an unread value can't be turned", () => {
    const { knob, onChange } = setup({ value: undefined });
    expect(knob.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(knob, { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
