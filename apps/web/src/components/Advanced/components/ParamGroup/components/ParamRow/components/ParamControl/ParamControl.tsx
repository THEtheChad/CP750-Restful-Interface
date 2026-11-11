import { type CSSProperties, type FormEvent, type KeyboardEvent, useId, useState } from "react";
import type { ParamValue, ValueSchema } from "../../../../../../../../api/types.ts";
import { controlFor, parseInput } from "../../../../../../../../lib/schema-control.ts";
import controls from "../../../../../../../../styles/controls.module.css";
import styles from "./ParamControl.module.css";

export interface ParamControlProps {
  schema: ValueSchema | null;
  value: ParamValue | undefined;
  disabled: boolean;
  /** A write to this param is in flight: the switch ignores clicks (and says so) meanwhile. */
  pending?: boolean;
  /** Id of the element naming the param. */
  labelledBy: string;
  describedBy?: string;
  /** May return a promise; the draft is kept until it settles. */
  onCommit: (value: ParamValue) => unknown;
}

/**
 * The control a value schema calls for (see `controlFor`). Switches commit on click; every other
 * control edits a draft that is only sent with Set (or Enter). Escape discards the draft.
 */
export function ParamControl({
  schema,
  value,
  disabled,
  pending = false,
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

  if (!schema || spec.kind === "none") return <span>{current || "–"}</span>;

  if (spec.kind === "switch") {
    const on = value === 1;
    return (
      <button
        type="button"
        role="switch"
        className={styles.switch}
        aria-checked={value === undefined ? undefined : on}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        disabled={disabled || value === undefined}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        onClick={() => {
          if (!pending) onCommit(on ? 0 : 1);
        }}
      >
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
        <span aria-hidden="true">{value === undefined ? "–" : on ? "On" : "Off"}</span>
      </button>
    );
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
