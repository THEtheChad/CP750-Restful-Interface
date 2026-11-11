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
  /** Shown on the target while its write is in flight. */
  pendingWord?: string;
  labelledBy: string;
  describedBy?: string | undefined;
}

/**
 * Every short enum, as a group of toggle buttons (one per option): one press chooses. Buttons,
 * not radios, so arrow keys move focus without changing the processor on every keypress. While a
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
  pendingWord = "Setting…",
  labelledBy,
  describedBy,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset
      className={`${styles.options} ${styles[size]}`}
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
            className={styles.option}
            data-pending={(pending && selected) || undefined}
            aria-pressed={selected}
            disabled={disabled}
            aria-disabled={pending || undefined}
            onClick={() => !pending && !selected && onChoose(option)}
          >
            <span className={styles.label}>{labelFor(option)}</span>
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
