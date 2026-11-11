import { useId } from "react";
import controls from "../../styles/controls.module.css";
import styles from "./LevelSteps.module.css";

const STEPS = [
  { delta: -1, label: "−1.0" },
  { delta: -0.1, label: "−0.1" },
  { delta: 0.1, label: "+0.1" },
  { delta: 1, label: "+1.0" },
] as const;

export interface LevelStepsProps {
  size: "glance" | "desk";
  disabled: boolean;
  /** Confirmed at reference: the reset cell shows "At reference" (same place, not a button). */
  atReference: boolean;
  resetDisabled: boolean;
  onStep: (displayDelta: number) => void;
  onReset: () => void;
  /**
   * How the buttons are named: `label` prefixes each step ("Fader +0.1"); `labelledBy` (the id of
   * the param's name) is appended to every button's own text ("+0.1 cp750.sys.fader_preset_1").
   */
  name: { label: string } | { labelledBy: string };
}

/** The level step row: −1.0 −0.1 [Reset to 7.0] +0.1 +1.0. Every level surface uses it. */
export function LevelSteps({
  size,
  disabled,
  atReference,
  resetDisabled,
  onStep,
  onReset,
  name,
}: LevelStepsProps) {
  const base = useId();
  const named = (id: string, text: string) =>
    "label" in name
      ? { "aria-label": `${name.label} ${text}` }
      : { "aria-labelledby": `${id} ${name.labelledBy}` };
  const stepButton = (s: (typeof STEPS)[number]) => {
    const id = `${base}${s.delta}`;
    return (
      <button
        key={s.label}
        id={id}
        type="button"
        className={size === "desk" ? `${controls.button} ${controls.small}` : controls.button}
        disabled={disabled}
        {...named(id, s.label)}
        onClick={() => onStep(s.delta)}
      >
        {s.label}
      </button>
    );
  };
  const resetId = `${base}reset`;
  return (
    <div className={`${styles.steps} ${styles[size]}`}>
      {STEPS.slice(0, 2).map(stepButton)}
      {atReference ? (
        <span className={styles.atReference}>At reference</span>
      ) : (
        <button
          id={resetId}
          type="button"
          // Primary at glance size only: in a dense list a blue reset on every row is noise.
          className={
            size === "desk"
              ? `${controls.button} ${controls.small} ${styles.reset}`
              : `${controls.button} ${controls.primary} ${styles.reset}`
          }
          disabled={disabled || resetDisabled}
          {...("labelledBy" in name ? { "aria-labelledby": `${resetId} ${name.labelledBy}` } : {})}
          onClick={onReset}
        >
          Reset to 7.0
        </button>
      )}
      {STEPS.slice(2).map(stepButton)}
    </div>
  );
}
