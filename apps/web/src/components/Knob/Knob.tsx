import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import styles from "./Knob.module.css";

/** Pixels of vertical drag per step; Shift makes it five times finer. */
const PX_PER_STEP = 8;
const FINE = 5;
const SWEEP = 270;

export interface KnobProps {
  /** The value as shown (the drag target while one is in progress), or `undefined` while unread. */
  value: number | undefined;
  min: number;
  max: number;
  disabled: boolean;
  /** The most one gesture may move it, from where the gesture started. */
  gestureLimit: number;
  labelledBy: string;
  describedBy?: string | undefined;
  valueText: string;
  onChange: (value: number) => void;
  onRelease: () => void;
  onCancel: () => void;
}

const angleOf = (v: number, min: number, max: number) =>
  -SWEEP / 2 + ((v - min) / (max - min)) * SWEEP;
const point = (deg: number, r: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [24 + r * Math.cos(rad), 24 + r * Math.sin(rad)] as const;
};
function arc(from: number, to: number, r: number): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const [x1, y1] = point(a, r);
  const [x2, y2] = point(b, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * A bipolar trim as a Pro-Q-style thin-arc knob: the arc grows from 0 (12 o'clock), a pointer
 * line shows the value even at 0. `role="slider"`.
 *
 * - Drag up to increase, 8px per step (Shift: finer). One gesture moves at most `gestureLimit`
 *   from where it started: release and grab again to go further.
 * - Touch: the first tap selects the knob (so a list still scrolls under a finger); then drag.
 * - Keys: arrows ±1, Page Up/Down ±10. No Home/End, no wheel, no double-click reset: a reset is
 *   an explicit typed change beside the knob.
 */
export function Knob({
  value,
  min,
  max,
  disabled,
  gestureLimit,
  labelledBy,
  describedBy,
  valueText,
  onChange,
  onRelease,
  onCancel,
}: KnobProps) {
  const [armedForTouch, setArmedForTouch] = useState(false);
  const gesture = useRef<{ startY: number; base: number; moved: boolean; touch: boolean } | null>(
    null,
  );
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const usable = !disabled && value !== undefined;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!usable) return;
    const touch = event.pointerType !== "mouse";
    gesture.current = { startY: event.clientY, base: value, moved: false, touch };
    if (touch && !armedForTouch) return; // let the page scroll; a tap selects (on pointer up)
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (!touch) event.currentTarget.focus({ focusVisible: false } as FocusOptions);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || (g.touch && !armedForTouch)) return;
    const px = event.shiftKey ? PX_PER_STEP * FINE : PX_PER_STEP;
    const steps = Math.round((g.startY - event.clientY) / px);
    const delta = Math.max(-gestureLimit, Math.min(gestureLimit, steps));
    if (steps !== 0) g.moved = true;
    onChange(clamp(g.base + delta));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.touch && !armedForTouch) {
      if (Math.abs(event.clientY - g.startY) < 10) setArmedForTouch(true);
      return;
    }
    if (g.moved) onRelease();
  };
  const onPointerCancel = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.moved) onCancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!usable) return;
    const delta = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
      PageUp: 10,
      PageDown: -10,
    }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onChange(clamp(value + delta));
  };

  const zero = angleOf(Math.max(min, Math.min(max, 0)), min, max);
  const at = value === undefined ? zero : angleOf(value, min, max);
  const [px, py] = point(at, 14);
  const [qx, qy] = point(at, 20);
  return (
    <div
      className={styles.knob}
      role="slider"
      tabIndex={usable ? 0 : -1}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={!usable || undefined}
      data-armed={armedForTouch || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      onKeyUp={() => onRelease()}
      onBlur={() => setArmedForTouch(false)}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path className={styles.track} d={arc(-SWEEP / 2, SWEEP / 2, 20)} />
        {value !== undefined && value !== 0 && (
          <path className={styles.value} d={arc(zero, at, 20)} />
        )}
        <line
          className={styles.zeroTick}
          x1={point(zero, 23)[0]}
          y1={point(zero, 23)[1]}
          x2={point(zero, 17)[0]}
          y2={point(zero, 17)[1]}
        />
        <circle className={styles.cap} cx="24" cy="24" r="13" />
        {value !== undefined && <line className={styles.pointer} x1={px} y1={py} x2={qx} y2={qy} />}
      </svg>
    </div>
  );
}
