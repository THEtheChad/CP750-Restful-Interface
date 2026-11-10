import { useId, useRef, useState } from "react";
import { useParam, useWriteParam } from "../../../../../../api/hooks.ts";
import type { Command, ParamValue } from "../../../../../../api/types.ts";
import { useInView } from "../../../../../../hooks/useInView.ts";
import { formatFader } from "../../../../../../lib/fader.ts";
import { type BlockContext, blockReason } from "../../../../../../lib/reasons.ts";
import controls from "../../../../../../styles/controls.module.css";
import { ProblemMessage } from "../../../../../ProblemMessage/ProblemMessage.tsx";
import { ActionButton } from "./components/ActionButton/ActionButton.tsx";
import { ParamControl } from "./components/ParamControl/ParamControl.tsx";
import styles from "./ParamRow.module.css";

/** The value in the param's unit, when that says more than the raw number. */
export function unitHint(value: ParamValue | undefined, unit: Command["unit"]): string | null {
  if (typeof value !== "number" || !unit) return null;
  switch (unit) {
    case "fader":
      return `display ${formatFader(value)}`;
    case "dB_tenths":
      return `${(value / 10).toFixed(1)} dB`;
    case "ms":
      return `${value} ms`;
    case "us":
      return `${value} µs`;
    case "feet_or_meters":
      return `${value} ft/m`;
  }
}

export interface ParamRowProps {
  command: Command;
  context: BlockContext;
}

/**
 * One parameter: name, badges, the control its schema calls for (or the action button), its
 * value, and why anything is disabled. Reads only once on screen, or on demand.
 */
export function ParamRow({ command, context }: ParamRowProps) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref);
  const [requested, setRequested] = useState(false);
  const nameId = useId();
  const reasonId = useId();

  const isAction = command.access === "action";
  const writable = command.access === "readwrite";
  const readReason = blockReason(command, "read", context);
  const writeReason = writable ? blockReason(command, "write", context) : null;
  const actionReason = isAction ? blockReason(command, "action", context) : null;
  const canRead = !isAction && readReason === null;

  const reading = useParam(command.name, { enabled: canRead && (inView || requested) });
  const write = useWriteParam(command.name);
  const value = reading.data?.value;
  const hint = unitHint(value, command.unit);
  const reason = isAction ? actionReason : writable ? writeReason : null;
  const shownReason = reason ?? (isAction ? null : readReason);

  const read = () => {
    if (requested || inView) void reading.refetch();
    else setRequested(true);
  };

  return (
    <li className={styles.row} ref={ref}>
      <div className={styles.head}>
        <code className={styles.name} id={nameId}>
          {command.name}
        </code>
        {command.aliases.map((a) => (
          <span key={a} className={styles.badge} title="Alias">
            {a}
          </span>
        ))}
        {command.access === "readonly" && <span className={styles.badge}>Read-only</span>}
        {isAction && <span className={styles.badge}>Action</span>}
        {command.source === "help" && <span className={styles.badge}>Raw</span>}
        {command.tier === "full" && (
          <span className={`${styles.badge} ${styles.badgeWarn}`}>Full set</span>
        )}
        {command.availability === "missing" && (
          <span className={`${styles.badge} ${styles.badgeWarn}`}>Not in help</span>
        )}
        {command.destructive && (
          <span className={`${styles.badge} ${styles.badgeDanger}`}>Destructive</span>
        )}
      </div>
      {command.description && <p className={styles.description}>{command.description}</p>}
      <div className={styles.body}>
        {isAction ? (
          <ActionButton
            command={command}
            reason={actionReason}
            {...(shownReason ? { describedBy: reasonId } : {})}
          />
        ) : writable ? (
          <ParamControl
            schema={command.schema}
            value={value}
            disabled={writeReason !== null || value === undefined}
            labelledBy={nameId}
            {...(shownReason ? { describedBy: reasonId } : {})}
            onCommit={(next) => write.mutateAsync({ value: next }).catch(() => {})}
          />
        ) : (
          <span className={styles.value}>{value === undefined ? "–" : String(value)}</span>
        )}
        {hint && <span className={styles.hint}>{hint}</span>}
        {!isAction && (
          <button
            type="button"
            className={`${controls.button} ${controls.small} ${styles.read}`}
            disabled={!canRead || reading.isFetching}
            aria-describedby={nameId}
            onClick={read}
          >
            {reading.isFetching ? "Reading…" : reading.data ? "Refresh" : "Read"}
          </button>
        )}
      </div>
      {shownReason && (
        <p className={controls.reason} id={reasonId}>
          {shownReason}
        </p>
      )}
      <ProblemMessage error={write.error ?? reading.error} />
    </li>
  );
}
