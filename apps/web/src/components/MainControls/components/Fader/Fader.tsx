import { type ReactNode, useId } from "react";
import { useFreshness, useParam, useParamAccess, useWritePending } from "../../../../api/hooks.ts";
import { useLevelWriter } from "../../../../hooks/useLevelWriter.ts";
import { FADER_NOMINAL, formatDb, formatFader } from "../../../../lib/fader.ts";
import { MAIN_PARAMS } from "../../../../lib/param-function.ts";
import { BlockedNote } from "../../../BlockedNote/BlockedNote.tsx";
import { LevelSteps } from "../../../LevelSteps/LevelSteps.tsx";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import { StaleBadge } from "../StaleBadge/StaleBadge.tsx";
import { VerticalFader } from "./components/VerticalFader/VerticalFader.tsx";
import styles from "./Fader.module.css";

export const FADER_PARAM = MAIN_PARAMS.fader;

const formatValue = (value: unknown) => formatFader(Number(value));

export interface FaderProps {
  throttleMs?: number;
  /** Shown beside the readout (the Mute key), as on the CP950's front panel. */
  beside?: ReactNode;
}

/**
 * The main fader: the level the processor confirmed as a big `7.0` with dB from the API, a
 * vertical fader that follows the operator while the processor catches up, and ±0.1/±1.0 steps
 * with a reset to 7.0. Safety rails (a wrong level is audible) live in `useLevelWriter`: steps
 * re-read the processor first; every send moves at most one page from the last known level and
 * bigger moves ramp; a failed send stops the move. The fader adds: a drag starts only on the cap,
 * a tap on the track is one page, the wheel does nothing.
 */
export function Fader({ throttleMs, beside }: FaderProps = {}) {
  const access = useParamAccess(FADER_PARAM);
  const reading = useParam(FADER_PARAM, { enabled: access.read === null, live: true });
  const pending = useWritePending(FADER_PARAM);
  const { stale } = useFreshness(FADER_PARAM);
  const writer = useLevelWriter(FADER_PARAM, {
    ...(throttleMs !== undefined ? { throttleMs } : {}),
  });
  const headingId = useId();
  const reasonId = useId();
  const errorId = useId();

  const committed = typeof reading.data?.value === "number" ? reading.data.value : null;
  const target = writer.draft;
  const moving = (target !== null && target !== committed) || pending;
  const db = reading.data?.db;
  const disabled = access.write !== null || committed === null;

  // Only a level the processor has confirmed (nothing in flight, not stale) is described
  // relative to reference; anything else says where it is going.
  const confirmed = committed !== null && !moving && !stale;
  const relation = (() => {
    if (committed === null) return null;
    if (moving) return `Setting ${formatFader(target ?? committed)}…`;
    if (!confirmed) return null; // stale: the Stale label says why
    if (committed === FADER_NOMINAL) return "reference";
    return committed > FADER_NOMINAL ? "above reference" : "below reference";
  })();
  const above = committed !== null && committed > FADER_NOMINAL;

  const valueText =
    committed === null
      ? "unknown"
      : moving
        ? `Setting ${formatFader(target ?? committed)}`
        : db !== undefined
          ? `${formatFader(committed)}, ${formatDb(db)}`
          : formatFader(committed);
  const describedBy = [access.write ? reasonId : null, writer.error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={styles.fader} aria-labelledby={headingId}>
      <h2 className="visually-hidden" id={headingId}>
        Fader
      </h2>
      <div className={styles.head}>
        {beside}
        <div className={stale ? `${styles.readout} ${styles.stale}` : styles.readout}>
          <span className={styles.value} data-testid="fader-value" aria-hidden="true">
            {committed === null ? "–.–" : formatFader(committed)}
          </span>
          <span className={styles.level}>
            <span className={styles.db} data-testid="fader-db" aria-hidden="true">
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
                aria-hidden="true"
              >
                {relation}
              </span>
            )}
            <StaleBadge name={FADER_PARAM} />
          </span>
        </div>
      </div>
      <div className={styles.strip}>
        <VerticalFader
          value={committed}
          target={target}
          disabled={disabled}
          stale={stale}
          labelledBy={headingId}
          describedBy={describedBy || undefined}
          valueText={valueText}
          onChange={writer.change}
          onRelease={writer.flush}
          onCancel={writer.cancel}
          onPage={(direction) => writer.step(direction)}
        />
        <LevelSteps
          size="glance"
          name={{ label: "Fader" }}
          disabled={disabled}
          atReference={confirmed && committed === FADER_NOMINAL}
          resetDisabled={committed === FADER_NOMINAL && !moving}
          onStep={writer.step}
          onReset={() => writer.commit(FADER_NOMINAL)}
        />
      </div>
      {access.write && <BlockedNote id={reasonId}>{access.write}</BlockedNote>}
      <ProblemMessage error={writer.error} formatValue={formatValue} id={errorId} />
      {!writer.error && <ProblemMessage error={reading.error} />}
    </section>
  );
}
