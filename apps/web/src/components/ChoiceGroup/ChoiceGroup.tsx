import controls from "../../styles/controls.module.css";
import { Icon } from "../Icon/Icon.tsx";
import styles from "./ChoiceGroup.module.css";

export interface ChoiceGroupProps<T extends string | number> {
  size: "glance" | "desk";
  options: readonly T[];
  /** The current (or, while pending, optimistic) value. */
  current: unknown;
  pending: boolean;
  disabled: boolean;
  /** Called with a different option. Ignored while pending. */
  onChoose: (option: T) => void;
  labelFor: (option: T) => string;
  /** Extra text on the key, e.g. the input's fader preset ("Preset 6.5"); glance size only. */
  detailFor?: (option: T) => string | null;
  /** Shown on the target while its write is in flight. */
  pendingWord?: string;
  labelledBy: string;
  describedBy?: string | undefined;
}

/**
 * Every short enum, as a group of keys (one per option; a lamp tray at glance size): one press
 * chooses. Keys, not radios, so arrow keys move focus without changing the processor on every
 * keypress. While a
 * write is pending the buttons are `aria-disabled` and the target shows `pendingWord` instead of
 * the confirmed (solid, checked) look. Disabled greys the other options, never the current one.
 */
export function ChoiceGroup<T extends string | number>({
  size,
  options,
  current,
  pending,
  disabled,
  onChoose,
  labelFor,
  detailFor,
  pendingWord = "Setting…",
  labelledBy,
  describedBy,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset
      className={
        size === "glance"
          ? `${styles.options} ${styles.glance} ${controls.tray}`
          : `${styles.options} ${styles.desk}`
      }
      aria-busy={pending || undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {options.map((option) => {
        const selected = current === option;
        return (
          <button
            key={String(option)}
            type="button"
            className={`${controls.button} ${size === "desk" ? controls.small : ""} ${styles.option}`}
            data-pending={(pending && selected) || undefined}
            aria-pressed={selected}
            disabled={disabled}
            aria-disabled={pending || undefined}
            onClick={() => !pending && !selected && onChoose(option)}
          >
            {size === "glance" && <span className={styles.lamp} aria-hidden="true" />}
            <span className={styles.label}>{labelFor(option)}</span>
            {size === "glance" && detailFor?.(option) && (
              <span className={styles.detail}>{detailFor(option)}</span>
            )}
            {selected && (
              <span className={styles.mark} aria-hidden="true">
                {pending ? pendingWord : <Icon name="check" />}
              </span>
            )}
          </button>
        );
      })}
      {options.length === 0 && <p>–</p>}
    </fieldset>
  );
}
