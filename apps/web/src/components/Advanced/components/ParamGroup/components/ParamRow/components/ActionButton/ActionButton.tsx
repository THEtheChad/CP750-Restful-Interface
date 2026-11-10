import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTriggerAction } from "../../../../../../../../api/hooks.ts";
import type { Command } from "../../../../../../../../api/types.ts";
import { shortLabel } from "../../../../../../../../lib/labels.ts";
import { controlFor, parseInput } from "../../../../../../../../lib/schema-control.ts";
import controls from "../../../../../../../../styles/controls.module.css";
import { ProblemMessage } from "../../../../../../../ProblemMessage/ProblemMessage.tsx";
import styles from "./ActionButton.module.css";

const WARNINGS: Record<string, string> = {
  "cp750.ctrl.reboot": "The processor restarts and the sound stops until it is back.",
  "cp750.ctrl.default_params": "Every setting goes back to factory defaults.",
  "cp750.ctrl.log_erase": "The processor's event log is erased.",
  "cp750.internal.save_params": "The current settings are written to the processor's memory.",
};

export interface ActionButtonProps {
  command: Command;
  /** Why the action is disabled; `null` when allowed. */
  reason: string | null;
  describedBy?: string;
  /** How long the confirmation stays open. */
  confirmTimeoutMs?: number;
}

/**
 * A `ctrl.*` action. Destructive actions need an inline second step ("Yes, reboot") that sends
 * `confirm: true`; the confirmation closes itself after a while, on Escape or on Cancel.
 */
export function ActionButton({
  command,
  reason,
  describedBy,
  confirmTimeoutMs = 15_000,
}: ActionButtonProps) {
  const action = useTriggerAction(command.name);
  const [confirming, setConfirming] = useState(false);
  const [valueText, setValueText] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const warningId = useId();
  const label = shortLabel(command.name);
  const spec = controlFor(command.schema);
  const takesValue = !command.destructive && (spec.kind === "range" || spec.kind === "number");
  const parsed =
    takesValue && valueText.trim() !== "" && command.schema
      ? parseInput(command.schema, valueText)
      : null;
  const disabled = reason !== null || action.isPending;

  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const timer = setTimeout(() => setConfirming(false), confirmTimeoutMs);
    return () => clearTimeout(timer);
  }, [confirming, confirmTimeoutMs]);

  const cancel = () => {
    setConfirming(false);
    triggerRef.current?.focus();
  };
  const onPanelKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancel();
  };

  if (command.destructive) {
    return (
      <div className={styles.action}>
        <button
          ref={triggerRef}
          type="button"
          className={`${controls.button} ${controls.danger}`}
          disabled={disabled}
          aria-expanded={confirming}
          aria-controls={panelId}
          aria-describedby={describedBy}
          onClick={() => {
            if (confirming) return cancel();
            action.reset();
            setConfirming(true);
          }}
        >
          {label}…
        </button>
        {confirming && (
          <fieldset
            id={panelId}
            className={styles.confirm}
            aria-labelledby={warningId}
            onKeyDown={onPanelKeyDown}
          >
            <p id={warningId}>
              <strong>{label}: are you sure?</strong>{" "}
              {WARNINGS[command.name] ?? "This action is destructive."}
            </p>
            <div className={styles.buttons}>
              <button
                type="button"
                className={`${controls.button} ${controls.dangerSolid}`}
                onClick={() => {
                  setConfirming(false);
                  action.mutate({ confirm: true });
                }}
              >
                Yes, {label.toLowerCase()}
              </button>
              <button ref={cancelRef} type="button" className={controls.button} onClick={cancel}>
                Cancel
              </button>
            </div>
          </fieldset>
        )}
        {action.isSuccess && (
          <p className={styles.sent} role="status">
            Sent. The processor replied “{action.data.raw}”.
          </p>
        )}
        <ProblemMessage error={action.error} />
      </div>
    );
  }

  const valueId = `${panelId}-value`;
  return (
    <div className={styles.action}>
      <div className={styles.line}>
        {takesValue && (
          <>
            <label className="visually-hidden" htmlFor={valueId}>
              {label} value
            </label>
            <input
              id={valueId}
              className={`${controls.field} ${controls.fieldSmall} ${styles.value}`}
              type="number"
              inputMode="numeric"
              placeholder="1"
              min={spec.kind === "range" || spec.kind === "number" ? spec.min : undefined}
              max={spec.kind === "range" || spec.kind === "number" ? spec.max : undefined}
              value={valueText}
              disabled={reason !== null}
              aria-invalid={parsed?.ok === false || undefined}
              onChange={(e) => setValueText(e.target.value)}
            />
          </>
        )}
        <button
          type="button"
          className={`${controls.button} ${controls.small}`}
          disabled={disabled || parsed?.ok === false}
          aria-describedby={describedBy}
          onClick={() => action.mutate(parsed?.ok ? { value: parsed.value } : {})}
        >
          {label}
        </button>
        {parsed && !parsed.ok && <span className={controls.reason}>{parsed.error}</span>}
      </div>
      {action.isSuccess && (
        <p className={styles.sent} role="status">
          Sent. The processor replied “{action.data.raw}”.
        </p>
      )}
      <ProblemMessage error={action.error} />
    </div>
  );
}
