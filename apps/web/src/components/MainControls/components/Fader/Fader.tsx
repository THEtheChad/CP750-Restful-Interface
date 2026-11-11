import { useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import {
  useApi,
  useFreshness,
  useParam,
  useParamAccess,
  useWriteParam,
  useWritePending,
} from "../../../../api/hooks.ts";
import { type ApiError, asApiError } from "../../../../api/problem.ts";
import { queryKeys } from "../../../../api/query-keys.ts";
import type { ParamReading } from "../../../../api/types.ts";
import { useLatestSender } from "../../../../hooks/useLatestSender.ts";
import {
  clampFader,
  FADER_MAX,
  FADER_MIN,
  FADER_NOMINAL,
  FADER_PAGE,
  formatDb,
  formatFader,
  stepFader,
} from "../../../../lib/fader.ts";
import controls from "../../../../styles/controls.module.css";
import { BlockedNote } from "../../../BlockedNote/BlockedNote.tsx";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import section from "../../section.module.css";
import { StaleBadge } from "../StaleBadge/StaleBadge.tsx";
import styles from "./Fader.module.css";

export const FADER_PARAM = "cp750.sys.fader";

const STEPS = [
  { delta: -1, label: "−1.0" },
  { delta: -0.1, label: "−0.1" },
  { delta: 0.1, label: "+0.1" },
  { delta: 1, label: "+1.0" },
] as const;

const formatValue = (value: unknown) => formatFader(Number(value));

/** Scale positions 0–10 (display units); 7 is the Dolby reference level. */
const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const REFERENCE = FADER_NOMINAL / 10;

/** Where a raw fader value sits on the track, 0–1. */
const fraction = (raw: number) => (raw - FADER_MIN) / (FADER_MAX - FADER_MIN);

/** `value` moved at most `max` away from `from`. */
function capStep(from: number, value: number, max: number): number {
  return clampFader(Math.max(from - max, Math.min(from + max, value)));
}

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
  const api = useApi();
  const queryClient = useQueryClient();
  const access = useParamAccess(FADER_PARAM);
  const reading = useParam(FADER_PARAM, { enabled: access.read === null, live: true });
  const write = useWriteParam(FADER_PARAM);
  const pending = useWritePending(FADER_PARAM);
  const { stale } = useFreshness(FADER_PARAM);
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const headingId = useId();
  const reasonId = useId();
  const errorId = useId();
  const sliderRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<{ start: number; first: boolean; limited: boolean } | null>(null);
  const steps = useRef<Promise<void>>(Promise.resolve());

  /** The level the processor last reported (or the optimistic one of a write in flight). */
  const known = () => {
    const value = queryClient.getQueryData<ParamReading>(queryKeys.param(FADER_PARAM))?.value;
    return typeof value === "number" ? value : null;
  };

  const sender = useLatestSender<number>(
    async (value) => {
      try {
        await write.mutateAsync({ value });
        setError(null);
      } catch (e) {
        setError(asApiError(e));
      }
    },
    {
      onIdle: () => setDraft(null),
      // Backstop: no single send moves more than one page from the last known level.
      limit: (target) => {
        const from = known();
        return from === null ? target : capStep(from, target, FADER_PAGE);
      },
      ...(throttleMs !== undefined ? { intervalMs: throttleMs } : {}),
    },
  );

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

  const change = (value: number) => {
    setDraft(value);
    sender.push(value);
  };
  const commit = (value: number) => {
    change(value);
    sender.flush();
  };

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
    sender.flush();
  };

  /** ±0.1/±1.0: read the processor, then step from its value. Clicks queue up in order. */
  const step = (delta: number) => {
    steps.current = steps.current.then(async () => {
      try {
        const fresh = await queryClient.fetchQuery({
          queryKey: queryKeys.param(FADER_PARAM),
          queryFn: () => api.readParam(FADER_PARAM),
          staleTime: 0,
        });
        if (typeof fresh.value !== "number") return;
        sender.cancel();
        setDraft(null);
        await write.mutateAsync({ value: stepFader(fresh.value, delta) });
        setError(null);
      } catch (e) {
        setError(asApiError(e));
      }
    });
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

  const stepButton = (s: (typeof STEPS)[number]) => (
    <button
      key={s.label}
      type="button"
      className={controls.button}
      disabled={disabled}
      aria-label={`Fader ${s.label}`}
      onClick={() => step(s.delta)}
    >
      {s.label}
    </button>
  );

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
          onKeyUp={() => sender.flush()}
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
      <div className={styles.steps}>
        {STEPS.slice(0, 2).map(stepButton)}
        {confirmed && shown === FADER_NOMINAL ? (
          <span className={styles.atReference}>At reference</span>
        ) : (
          <button
            type="button"
            className={`${controls.button} ${controls.primary} ${styles.nominal}`}
            disabled={disabled || shown === FADER_NOMINAL}
            onClick={() => commit(FADER_NOMINAL)}
          >
            Reset to 7.0
          </button>
        )}
        {STEPS.slice(2).map(stepButton)}
      </div>
      {access.write && <BlockedNote id={reasonId}>{access.write}</BlockedNote>}
      <ProblemMessage error={error} formatValue={formatValue} id={errorId} />
      {!error && <ProblemMessage error={reading.error} />}
    </section>
  );
}
