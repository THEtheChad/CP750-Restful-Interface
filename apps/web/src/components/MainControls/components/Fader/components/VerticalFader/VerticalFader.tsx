import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { FADER_MAX, FADER_MIN, FADER_NOMINAL, FADER_PAGE } from "../../../../../../lib/fader.ts";
import styles from "./VerticalFader.module.css";

/** Half the cap's touch zone: a drag only starts within this distance of the cap's centre. */
export const CAP_GRAB_PX = 28;
/** A press that moves less than this is a tap (one page toward it), not a drag. */
const TAP_SLOP_PX = 10;

const KEY_STEPS: Record<string, number> = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
  PageUp: FADER_PAGE,
  PageDown: -FADER_PAGE,
};

const pct = (raw: number) => `${(1 - (raw - FADER_MIN) / (FADER_MAX - FADER_MIN)) * 100}%`;
const clamp = (raw: number) => Math.max(FADER_MIN, Math.min(FADER_MAX, Math.round(raw)));

export interface VerticalFaderProps {
  /** What the processor holds (confirmed), or `null` while unknown. */
  value: number | null;
  /** Where the operator is taking it (a drag or ramp in progress), or `null`. */
  target: number | null;
  disabled: boolean;
  stale: boolean;
  labelledBy: string;
  describedBy?: string | undefined;
  valueText: string;
  /** Queue a new target (drag move, key press). Sends are capped and ramped by the caller. */
  onChange: (raw: number) => void;
  /** The gesture ended (pointer up, key up): send what is queued now. */
  onRelease: () => void;
  /** The gesture was cancelled (pointer cancel): drop what is queued. */
  onCancel: () => void;
  /** A tap on the track: one page (1.0) toward it, from a fresh read. */
  onPage: (direction: 1 | -1) => void;
}

/**
 * The main fader as a vertical `role="slider"`, drawn as distance from reference: no fill at 7.0,
 * blue from the level up to the 7.0 mark below it, amber from the mark up to the level above it.
 * The fill shows what the audience hears (confirmed); a dashed cap shows the target while the
 * processor catches up.
 *
 * - A drag must start on the cap (a 56px touch zone), so a scroll that lands on the track never
 *   sets the level; the cap then follows the finger and the caller ramps the sends.
 * - A tap on the track moves one page toward it.
 * - Keys: arrows ±0.1, Page Up/Down ±1.0, Home/End to the ends (ramped by the caller).
 * - The wheel is ignored: it scrolls the page.
 */
export function VerticalFader({
  value,
  target,
  disabled,
  stale,
  labelledBy,
  describedBy,
  valueText,
  onChange,
  onRelease,
  onCancel,
  onPage,
}: VerticalFaderProps) {
  const gesture = useRef<{ mode: "drag" | "tap"; startY: number; capY: number } | null>(null);
  const shown = target ?? value;
  const moving = target !== null && target !== value;

  const rawAt = (el: HTMLElement, clientY: number) => {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return null;
    return clamp(FADER_MAX - ((clientY - rect.top) / rect.height) * (FADER_MAX - FADER_MIN));
  };
  const capYOf = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const at = shown ?? FADER_NOMINAL;
    return rect.top + (1 - (at - FADER_MIN) / (FADER_MAX - FADER_MIN)) * rect.height;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || shown === null) return;
    const el = event.currentTarget;
    const capY = capYOf(el);
    const mode = Math.abs(event.clientY - capY) <= CAP_GRAB_PX ? "drag" : "tap";
    gesture.current = { mode, startY: event.clientY, capY };
    event.preventDefault();
    el.setPointerCapture?.(event.pointerId);
    // Focus for keyboard follow-up, without the keyboard focus ring.
    if (event.pointerType === "mouse") el.focus({ focusVisible: false } as FocusOptions);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.mode !== "drag") return;
    const raw = rawAt(event.currentTarget, event.clientY);
    if (raw !== null) onChange(raw);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.mode === "drag") onRelease();
    else if (Math.abs(event.clientY - g.startY) < TAP_SLOP_PX)
      onPage(event.clientY < g.capY ? 1 : -1);
  };
  const onPointerCancel = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.mode === "drag") onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || shown === null) return;
    const step = KEY_STEPS[event.key];
    const next =
      step !== undefined
        ? shown + step
        : event.key === "Home"
          ? FADER_MIN
          : event.key === "End"
            ? FADER_MAX
            : null;
    if (next === null) return;
    event.preventDefault();
    onChange(clamp(next));
  };

  const fillFrom = value ?? FADER_NOMINAL;
  const tone =
    value === null || value === FADER_NOMINAL ? null : value > FADER_NOMINAL ? "above" : "below";
  const ticks = [];
  for (let raw = FADER_MIN; raw <= FADER_MAX; raw += 5) {
    const major = raw % 10 === 0;
    ticks.push(
      <span
        key={`t${raw}`}
        className={major ? styles.tickMajor : styles.tick}
        style={{ top: pct(raw) }}
      />,
    );
    if (major) {
      ticks.push(
        <span
          key={`n${raw}`}
          className={raw === FADER_NOMINAL ? `${styles.num} ${styles.numRef}` : styles.num}
          data-minor={raw % 20 !== 0 && raw !== FADER_NOMINAL ? "" : undefined}
          style={{ top: pct(raw) }}
        >
          {raw / 10}
        </span>,
      );
    }
  }

  return (
    <div
      className={stale ? `${styles.fader} ${styles.stale}` : styles.fader}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-orientation="vertical"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-valuemin={FADER_MIN / 10}
      aria-valuemax={FADER_MAX / 10}
      aria-valuenow={shown === null ? undefined : shown / 10}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key in KEY_STEPS || event.key === "Home" || event.key === "End") onRelease();
      }}
    >
      <span className={styles.slot} aria-hidden="true" />
      {tone && (
        <span
          className={
            tone === "above" ? `${styles.fill} ${styles.above}` : `${styles.fill} ${styles.below}`
          }
          style={{
            top: pct(Math.max(fillFrom, FADER_NOMINAL)),
            bottom: `calc(100% - ${pct(Math.min(fillFrom, FADER_NOMINAL))})`,
          }}
          aria-hidden="true"
        />
      )}
      <span className={styles.scale} aria-hidden="true">
        {ticks}
      </span>
      <span className={styles.reference} style={{ top: pct(FADER_NOMINAL) }} aria-hidden="true" />
      {value !== null && moving && (
        <span className={styles.ghost} style={{ top: pct(value) }} aria-hidden="true" />
      )}
      {shown !== null && (
        <span
          className={moving ? `${styles.cap} ${styles.capTarget}` : styles.cap}
          style={{ top: pct(shown) }}
          data-testid="fader-cap"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
