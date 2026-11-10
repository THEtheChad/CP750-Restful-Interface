import { useId, useState } from "react";
import { useParam, useParamAccess, useWriteParam } from "../../../../api/hooks.ts";
import { type ApiError, asApiError } from "../../../../api/problem.ts";
import { useLatestSender } from "../../../../hooks/useLatestSender.ts";
import {
  FADER_MAX,
  FADER_MIN,
  FADER_NOMINAL,
  formatDb,
  formatFader,
  stepFader,
} from "../../../../lib/fader.ts";
import controls from "../../../../styles/controls.module.css";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import card from "../../card.module.css";
import styles from "./Fader.module.css";

export const FADER_PARAM = "cp750.sys.fader";

const STEPS = [
  { delta: -1, label: "−1.0" },
  { delta: -0.1, label: "−0.1" },
  { delta: 0.1, label: "+0.1" },
  { delta: 1, label: "+1.0" },
] as const;

const formatValue = (value: unknown) => formatFader(Number(value));

/**
 * The main fader: a big `7.0` readout with dB from the API, a slider, ±0.1/±1.0 steps and a return
 * to 7.0. Writes are throttled (newest value only, one in flight) and the final value is
 * committed on release.
 */
export function Fader({ throttleMs }: { throttleMs?: number } = {}) {
  const access = useParamAccess(FADER_PARAM);
  const reading = useParam(FADER_PARAM, { enabled: access.read === null, live: true });
  const write = useWriteParam(FADER_PARAM);
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const headingId = useId();
  const reasonId = useId();
  const errorId = useId();

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
      ...(throttleMs !== undefined ? { intervalMs: throttleMs } : {}),
    },
  );

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

  const valueText =
    shown === null
      ? "unknown"
      : settled && db !== undefined
        ? `${formatFader(shown)}, ${formatDb(db)}`
        : formatFader(shown);
  const describedBy = [access.write ? reasonId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={card.card} aria-labelledby={headingId}>
      <h2 className={card.heading} id={headingId}>
        Fader
      </h2>
      <div className={styles.readout} aria-hidden="true">
        <span className={styles.value} data-testid="fader-value">
          {shown === null ? "–.–" : formatFader(shown)}
        </span>
        <span
          className={settled ? styles.db : `${styles.db} ${styles.pending}`}
          data-testid="fader-db"
        >
          {formatDb(db)}
        </span>
      </div>
      <input
        className={styles.slider}
        type="range"
        min={FADER_MIN}
        max={FADER_MAX}
        step={1}
        value={shown ?? FADER_NOMINAL}
        disabled={disabled}
        aria-labelledby={headingId}
        aria-valuetext={valueText}
        aria-describedby={describedBy || undefined}
        onChange={(e) => change(Number(e.currentTarget.value))}
        onPointerUp={() => sender.flush()}
        onKeyUp={() => sender.flush()}
        onBlur={() => sender.flush()}
      />
      <div className={styles.steps}>
        {STEPS.slice(0, 2).map((s) => (
          <button
            key={s.label}
            type="button"
            className={controls.button}
            disabled={disabled}
            aria-label={`Fader ${s.label}`}
            onClick={() => shown !== null && commit(stepFader(shown, s.delta))}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          className={`${controls.button} ${controls.primary} ${styles.nominal}`}
          disabled={disabled || shown === FADER_NOMINAL}
          aria-label="Return fader to 7.0 (0 dB)"
          onClick={() => commit(FADER_NOMINAL)}
        >
          7.0
        </button>
        {STEPS.slice(2).map((s) => (
          <button
            key={s.label}
            type="button"
            className={controls.button}
            disabled={disabled}
            aria-label={`Fader ${s.label}`}
            onClick={() => shown !== null && commit(stepFader(shown, s.delta))}
          >
            {s.label}
          </button>
        ))}
      </div>
      {access.write && (
        <p className={controls.reason} id={reasonId}>
          {access.write}
        </p>
      )}
      <ProblemMessage error={error} formatValue={formatValue} id={errorId} />
      {!error && <ProblemMessage error={reading.error} />}
    </section>
  );
}
