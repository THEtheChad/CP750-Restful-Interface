import { type ToggleVocabulary, toggleState } from "../../lib/param-function.ts";
import { Icon } from "../Icon/Icon.tsx";
import styles from "./ToggleButton.module.css";

export interface ToggleButtonProps {
  size: "glance" | "desk";
  vocabulary: ToggleVocabulary;
  /** The current (or, while pending, optimistic) value: 0, 1, or unknown. */
  value: unknown;
  pending: boolean;
  disabled: boolean;
  /** Toggles to `next`. Ignored while pending, so a double press can't send two. */
  onToggle: (next: 0 | 1) => void;
  describedBy?: string | undefined;
  /** glance: the visible, stable name ("Mute"). desk: the id of the param's name. */
  name: { label: string } | { labelledBy: string };
}

/**
 * Every 0/1 param, as a toggle button with a stable name and `aria-pressed` for its state. The
 * state word ("Muted", "Turning on…", "Unknown") is visible but not part of the name. The solid
 * "on" look only shows once the processor has confirmed; pending is dashed. Pending uses
 * `aria-disabled` so the button keeps keyboard focus. Disabled never hides that it is on.
 */
export function ToggleButton({
  size,
  vocabulary,
  value,
  pending,
  disabled,
  onToggle,
  describedBy,
  name,
}: ToggleButtonProps) {
  const state = toggleState(value, pending, vocabulary);
  const speaker = vocabulary.onTone === "danger";
  return (
    <button
      type="button"
      className={`${styles.toggle} ${styles[size]}`}
      data-tone={state.tone}
      data-on-tone={vocabulary.onTone}
      aria-pressed={state.known ? state.on : undefined}
      disabled={disabled || !state.known}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      aria-describedby={describedBy}
      {...("labelledBy" in name ? { "aria-labelledby": name.labelledBy } : {})}
      onClick={() => {
        if (!pending) onToggle(state.on ? 0 : 1);
      }}
    >
      {speaker ? (
        <Icon name={state.on ? "speakerOff" : "speaker"} className={styles.icon} />
      ) : (
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
      )}
      {"label" in name && <span className={styles.label}>{name.label}</span>}
      <span className={styles.state} aria-hidden="true">
        {state.word}
      </span>
    </button>
  );
}
