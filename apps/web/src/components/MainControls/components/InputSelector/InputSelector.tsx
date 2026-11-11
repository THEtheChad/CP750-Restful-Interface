import { useId } from "react";
import { useParam, useParamAccess, useWriteParam, useWritePending } from "../../../../api/hooks.ts";
import { humanize } from "../../../../lib/labels.ts";
import { BlockedNote } from "../../../BlockedNote/BlockedNote.tsx";
import { Icon } from "../../../Icon/Icon.tsx";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import section from "../../section.module.css";
import { StaleBadge } from "../StaleBadge/StaleBadge.tsx";
import styles from "./InputSelector.module.css";

export const INPUT_PARAM = "cp750.sys.input_mode";

const formatValue = (value: unknown) => humanize(String(value));

/**
 * The input, as a group of toggle buttons (one per enum value from the manifest). Buttons, not
 * radios: arrow keys move focus without switching the processor's input on every keypress. While
 * an input write is pending the buttons are `aria-disabled` and ignore clicks, and the target shows
 * "Switching…" instead of the confirmed (solid, checked) look.
 */
export function InputSelector() {
  const access = useParamAccess(INPUT_PARAM);
  const reading = useParam(INPUT_PARAM, { enabled: access.read === null, live: true });
  const write = useWriteParam(INPUT_PARAM);
  const pending = useWritePending(INPUT_PARAM);
  const headingId = useId();
  const reasonId = useId();
  const options = (access.command?.schema?.enum ?? []).map(String);
  const current = reading.data?.value;
  const disabled = access.write !== null;

  return (
    <section className={section.section} aria-labelledby={headingId}>
      <div className={section.header}>
        <h2 className={section.heading} id={headingId}>
          Input
        </h2>
        <StaleBadge name={INPUT_PARAM} />
      </div>
      <fieldset
        className={styles.options}
        aria-busy={pending || undefined}
        aria-labelledby={headingId}
        aria-describedby={access.write ? reasonId : undefined}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={styles.option}
            data-pending={(pending && current === option) || undefined}
            aria-pressed={current === option}
            disabled={disabled}
            aria-disabled={pending || undefined}
            onClick={() => !pending && current !== option && write.mutate({ value: option })}
          >
            <span className={styles.label}>{humanize(option)}</span>
            {current === option && (
              <span className={styles.mark} aria-hidden="true">
                {pending ? "Switching…" : <Icon name="check" />}
              </span>
            )}
          </button>
        ))}
        {options.length === 0 && <p>–</p>}
      </fieldset>
      {access.write && <BlockedNote id={reasonId}>{access.write}</BlockedNote>}
      <ProblemMessage error={write.error} formatValue={formatValue} />
      {!write.error && <ProblemMessage error={reading.error} />}
    </section>
  );
}
