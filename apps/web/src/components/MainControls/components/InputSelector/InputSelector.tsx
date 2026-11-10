import { useId } from "react";
import { useParam, useParamAccess, useWriteParam } from "../../../../api/hooks.ts";
import { humanize } from "../../../../lib/labels.ts";
import controls from "../../../../styles/controls.module.css";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import card from "../../card.module.css";
import styles from "./InputSelector.module.css";

export const INPUT_PARAM = "cp750.sys.input_mode";

const formatValue = (value: unknown) => humanize(String(value));

/**
 * The input, as a group of toggle buttons (one per enum value from the manifest). Buttons, not
 * radios: arrow keys move focus without switching the processor's input on every keypress.
 */
export function InputSelector() {
  const access = useParamAccess(INPUT_PARAM);
  const reading = useParam(INPUT_PARAM, { enabled: access.read === null, live: true });
  const write = useWriteParam(INPUT_PARAM);
  const headingId = useId();
  const reasonId = useId();
  const options = (access.command?.schema?.enum ?? []).map(String);
  const current = reading.data?.value;
  const disabled = access.write !== null;

  return (
    <section className={card.card} aria-labelledby={headingId}>
      <h2 className={card.heading} id={headingId}>
        Input
      </h2>
      <fieldset
        className={styles.options}
        aria-labelledby={headingId}
        aria-describedby={access.write ? reasonId : undefined}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={styles.option}
            aria-pressed={current === option}
            disabled={disabled}
            onClick={() => current !== option && write.mutate({ value: option })}
          >
            <span className={styles.label}>{humanize(option)}</span>
            <span className={styles.raw} aria-hidden="true">
              {option}
            </span>
          </button>
        ))}
        {options.length === 0 && <p>–</p>}
      </fieldset>
      {access.write && (
        <p className={controls.reason} id={reasonId}>
          {access.write}
        </p>
      )}
      <ProblemMessage error={write.error} formatValue={formatValue} />
      {!write.error && <ProblemMessage error={reading.error} />}
    </section>
  );
}
