import { type CSSProperties, type FormEvent, type KeyboardEvent, useId, useState } from "react";
import type { ParamValue, ValueSchema } from "../../../../../../../../api/types.ts";
import { controlFor, parseInput } from "../../../../../../../../lib/schema-control.ts";
import controls from "../../../../../../../../styles/controls.module.css";
import styles from "./ParamControl.module.css";

export interface ParamControlProps {
  schema: ValueSchema | null;
  value: ParamValue | undefined;
  disabled: boolean;
  /** Id of the element naming the param. */
  labelledBy: string;
  describedBy?: string;
  /** May return a promise; the draft is kept until it settles. */
  onCommit: (value: ParamValue) => unknown;
}

/**
 * The draft-and-Set control for entries and long lists (see `functionOf`; toggles, short choices
 * and levels have their own shared surfaces). Edits a draft that is only sent with Set (or
 * Enter). Escape discards the draft.
 */
export function ParamControl({
  schema,
  value,
  disabled,
  labelledBy,
  describedBy,
  onCommit,
}: ParamControlProps) {
  const spec = controlFor(schema);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const numberLabelId = useId();
  const setId = useId();
  const undoId = useId();
  const current = value === undefined ? "" : String(value);

  if (!schema || spec.kind === "none" || spec.kind === "switch") {
    return <span>{current || "–"}</span>;
  }

  const text = draft ?? current;
  const parsed = draft === null ? null : parseInput(schema, draft);
  const dirty = draft !== null && draft !== current;
  const invalid = parsed !== null && !parsed.ok;
  const fieldProps = {
    disabled,
    "aria-labelledby": labelledBy,
    "aria-describedby":
      [invalid ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": invalid || undefined,
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || !parsed?.ok || disabled) return;
    setBusy(true);
    try {
      await onCommit(parsed.value);
    } finally {
      setBusy(false);
      setDraft(null);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") setDraft(null);
  };

  return (
    <form className={styles.form} onSubmit={submit} onKeyDown={onKeyDown}>
      {spec.kind === "select" && (
        <select
          className={`${controls.field} ${controls.fieldSmall}`}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          {...fieldProps}
        >
          {value === undefined && <option value="">–</option>}
          {spec.options.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      )}
      {spec.kind === "range" && (
        <input
          className={styles.slider}
          type="range"
          min={spec.min}
          max={spec.max}
          step={1}
          value={text === "" || Number.isNaN(Number(text)) ? spec.min : Number(text)}
          style={
            {
              "--p":
                text === "" || Number.isNaN(Number(text))
                  ? 0
                  : (Number(text) - spec.min) / (spec.max - spec.min || 1),
            } as CSSProperties
          }
          onChange={(e) => setDraft(e.target.value)}
          {...fieldProps}
        />
      )}
      {(spec.kind === "range" || spec.kind === "number") && (
        <>
          <span id={numberLabelId} className="visually-hidden">
            (number)
          </span>
          <input
            className={`${controls.field} ${controls.fieldSmall} ${styles.number}`}
            type="number"
            inputMode="numeric"
            step={1}
            min={spec.min}
            max={spec.max}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            {...fieldProps}
            aria-labelledby={`${labelledBy} ${numberLabelId}`}
          />
        </>
      )}
      {spec.kind === "text" && (
        <input
          className={`${controls.field} ${controls.fieldSmall} ${styles.text}`}
          type="text"
          maxLength={spec.maxLength}
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          {...fieldProps}
        />
      )}
      {/* "Set cp750.sys.x": every row has these buttons, so each name includes the param. */}
      <button
        type="submit"
        id={setId}
        className={`${controls.button} ${controls.small} ${controls.primary}`}
        disabled={disabled || !dirty || invalid || busy}
        aria-labelledby={`${setId} ${labelledBy}`}
      >
        Set
      </button>
      {dirty && (
        <button
          type="button"
          id={undoId}
          className={`${controls.button} ${controls.small}`}
          aria-labelledby={`${undoId} ${labelledBy}`}
          onClick={() => setDraft(null)}
        >
          Undo
        </button>
      )}
      {invalid && parsed && !parsed.ok && (
        <span className={styles.invalid} id={errorId}>
          {parsed.error}
        </span>
      )}
    </form>
  );
}
