import { type CSSProperties, useEffect, useId, useRef } from "react";
import { useFreshness, useParam, useParamAccess, useWritePending } from "../../../../api/hooks.ts";
import { capStep, useLevelWriter } from "../../../../hooks/useLevelWriter.ts";
import {
  FADER_MAX,
  FADER_MIN,
  FADER_NOMINAL,
  FADER_PAGE,
  formatDb,
  formatFader,
} from "../../../../lib/fader.ts";
import { MAIN_PARAMS } from "../../../../lib/param-function.ts";
import { BlockedNote } from "../../../BlockedNote/BlockedNote.tsx";
import { LevelSteps } from "../../../LevelSteps/LevelSteps.tsx";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import section from "../../section.module.css";
import { StaleBadge } from "../StaleBadge/StaleBadge.tsx";
import styles from "./Fader.module.css";

export const FADER_PARAM = MAIN_PARAMS.fader;

const formatValue = (value: unknown) => formatFader(Number(value));

/** Scale positions 0–10 (display units); 7 is the Dolby reference level. */
const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const REFERENCE = FADER_NOMINAL / 10;

/** Where a raw fader value sits on the track, 0–1. */
const fraction = (raw: number) => (raw - FADER_MIN) / (FADER_MAX - FADER_MIN);

/**
 * The main fader: a big `7.0` readout with dB from the API, a slider, ±0.1/±1.0 steps and a return
 * to 7.0. Writes are throttled (newest value only, one in flight) and the final value is
 * committed on release. Safety rails, since a wrong level is audible:
 *
 * - the step buttons re-read the fader first and step from what the processor holds, not from a
 *   possibly stale display, one step at a time;
 * - a click on the track (a pointer gesture that starts away from the thumb) moves one page
 *   (±1.0) toward the click, not to it;
 * - the wheel never moves it;
 * - every send moves at most one page from the last known level; bigger moves (keyboard
 *   Home/End, a fast drag) ramp there one page per send.
 */
export function Fader({ throttleMs }: { throttleMs?: number } = {}) {
  const access = useParamAccess(FADER_PARAM);
  const reading = useParam(FADER_PARAM, { enabled: access.read === null, live: true });
  const pending = useWritePending(FADER_PARAM);
  const { stale } = useFreshness(FADER_PARAM);
  const { draft, error, change, commit, flush, step } = useLevelWriter(FADER_PARAM, {
    ...(throttleMs !== undefined ? { throttleMs } : {}),
  });
  const headingId = useId();
  const reasonId = useId();
  const errorId = useId();
  const sliderRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<{ start: number; first: boolean; limited: boolean } | null>(null);

  // React's onWheel is passive, so preventDefault needs a native listener.
  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;
    const block = (event: WheelEvent) => event.preventDefault();
    slider.addEventListener("wheel", block, { passive: false });
    return () => slider.removeEventListener("wheel", block);
  }, []);

  const committed = typeof reading.data?.value === "number" ? reading.data.value : null;
  const shown = draft ?? committed;
  const settled = draft === null || draft === committed;
  const db = reading.data?.db;
  const disabled = access.write !== null || shown === null;

  /** A slider change; limits a gesture that started on the track to one page from its start. */
  const slide = (value: number) => {
    const g = gesture.current;
    if (g) {
      if (g.first) {
        g.first = false;
        g.limited = Math.abs(value - g.start) > FADER_PAGE;
      }
      if (g.limited) value = capStep(g.start, value, FADER_PAGE);
    }
    change(value);
  };
  const endGesture = () => {
    gesture.current = null;
    flush();
  };

  // Only a level the processor has confirmed (no draft, nothing in flight, not stale) is
  // described relative to reference; anything else says it is still being set.
  const confirmed = committed !== null && settled && !pending && !stale;
  const relation = (() => {
    if (shown === null) return null;
    if (pending || !settled) return `Setting ${formatFader(shown)}…`;
    if (!confirmed) return null; // stale: the Stale label says why
    if (shown === FADER_NOMINAL) return "reference";
    return shown > FADER_NOMINAL ? "above reference" : "below reference";
  })();
  const above = shown !== null && shown > FADER_NOMINAL;

  const valueText =
    shown === null
      ? "unknown"
      : settled && db !== undefined
        ? `${formatFader(shown)}, ${formatDb(db)}`
        : formatFader(shown);
  const describedBy = [access.write ? reasonId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");
  const trackStyle = { "--p": fraction(shown ?? FADER_NOMINAL) } as CSSProperties;

  return (
    <section className={section.section} aria-labelledby={headingId}>
      <div className={section.header}>
        <h2 className={section.heading} id={headingId}>
          Fader
        </h2>
        <StaleBadge name={FADER_PARAM} />
      </div>
      <div
        className={stale ? `${styles.readout} ${styles.stale}` : styles.readout}
        aria-hidden="true"
      >
        <span className={styles.value} data-testid="fader-value">
          {shown === null ? "–.–" : formatFader(shown)}
        </span>
        <span className={styles.level}>
          <span
            className={settled ? styles.db : `${styles.db} ${styles.pending}`}
            data-testid="fader-db"
          >
            {formatDb(db)}
          </span>
          {relation && (
            <span
              className={
                !confirmed
                  ? styles.setting
                  : above
                    ? `${styles.relation} ${styles.above}`
                    : styles.relation
              }
            >
              {relation}
            </span>
          )}
        </span>
      </div>
      <div className={styles.track}>
        <input
          ref={sliderRef}
          className={above ? `${styles.slider} ${styles.sliderAbove}` : styles.slider}
          style={trackStyle}
          type="range"
          min={FADER_MIN}
          max={FADER_MAX}
          step={1}
          value={shown ?? FADER_NOMINAL}
          disabled={disabled}
          aria-labelledby={headingId}
          aria-valuetext={valueText}
          aria-describedby={describedBy || undefined}
          onPointerDown={() => {
            if (shown !== null) gesture.current = { start: shown, first: true, limited: false };
          }}
          onChange={(e) => slide(Number(e.currentTarget.value))}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onKeyUp={flush}
          onBlur={endGesture}
        />
        {/* Decorative: never intercepts the track's pointer handling. */}
        <div className={styles.scale} aria-hidden="true">
          {SCALE.map((n) => (
            <span
              key={n}
              className={n === REFERENCE ? `${styles.tick} ${styles.reference}` : styles.tick}
              style={{ "--at": n / 10 } as CSSProperties}
            >
              {n}
            </span>
          ))}
        </div>
      </div>
      <LevelSteps
        size="glance"
        name={{ label: "Fader" }}
        disabled={disabled}
        atReference={confirmed && shown === FADER_NOMINAL}
        resetDisabled={shown === FADER_NOMINAL}
        onStep={step}
        onReset={() => commit(FADER_NOMINAL)}
      />
      {access.write && <BlockedNote id={reasonId}>{access.write}</BlockedNote>}
      <ProblemMessage error={error} formatValue={formatValue} id={errorId} />
      {!error && <ProblemMessage error={reading.error} />}
    </section>
  );
}
