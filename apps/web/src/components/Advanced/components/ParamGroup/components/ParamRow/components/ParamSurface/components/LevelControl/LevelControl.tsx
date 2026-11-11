import { useLevelWriter } from "../../../../../../../../../../hooks/useLevelWriter.ts";
import { FADER_NOMINAL, formatDb, formatFader } from "../../../../../../../../../../lib/fader.ts";
import { LevelSteps } from "../../../../../../../../../LevelSteps/LevelSteps.tsx";
import { ProblemMessage } from "../../../../../../../../../ProblemMessage/ProblemMessage.tsx";
import styles from "./LevelControl.module.css";

export interface LevelControlProps {
  name: string;
  nameId: string;
  value: number | undefined;
  db: number | undefined;
  pending: boolean;
}

/**
 * A fader-unit param in the Advanced list (the main fader, the fader presets): its level and the
 * shared step row, on the same write engine as the main fader. No free-form entry, so no single
 * change moves it more than 1.0; Reset ramps there one page per send.
 */
export function LevelControl({ name, nameId, value, db, pending }: LevelControlProps) {
  const { draft, error, commit, step } = useLevelWriter(name);
  const shown = draft ?? value;
  return (
    <div className={styles.level}>
      <span className={styles.readout}>
        <span className={styles.value}>{shown === undefined ? "–.–" : formatFader(shown)}</span>
        {db !== undefined && <span className={styles.db}>{formatDb(db)}</span>}
      </span>
      <LevelSteps
        size="desk"
        name={{ labelledBy: nameId }}
        disabled={value === undefined}
        atReference={shown === FADER_NOMINAL && draft === null && !pending}
        resetDisabled={shown === FADER_NOMINAL}
        onStep={step}
        onReset={() => commit(FADER_NOMINAL)}
      />
      <ProblemMessage error={error} formatValue={(v) => formatFader(Number(v))} />
    </div>
  );
}
