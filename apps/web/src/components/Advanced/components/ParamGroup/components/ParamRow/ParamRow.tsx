import { Fragment, useId, useRef, useState } from "react";
import { useParam, useWriteParam, useWritePending } from "../../../../../../api/hooks.ts";
import type { Command, ParamValue } from "../../../../../../api/types.ts";
import { useInView } from "../../../../../../hooks/useInView.ts";
import { formatFader } from "../../../../../../lib/fader.ts";
import { type BlockContext, type BlockInfo, blockInfo } from "../../../../../../lib/reasons.ts";
import controls from "../../../../../../styles/controls.module.css";
import { Icon } from "../../../../../Icon/Icon.tsx";
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

/** `dig_1_global_delay` with a break opportunity after each `_`, so long names wrap at words. */
function breakable(text: string) {
  return text.split("_").map((part, i, parts) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: parts of one static string
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          _<wbr />
        </>
      )}
    </Fragment>
  ));
}

/**
 * `cp750.sys.` muted, the distinguishing part in full weight. Never truncated: names wrap. The
 * accessible name (`id`, used by the row's controls) is the whole name as one text node, so no
 * assistive tech splits it at the styling boundary.
 */
function ParamName({ name, id }: { name: string; id: string }) {
  const cut = name.lastIndexOf(".") + 1;
  return (
    <code className={styles.name}>
      <span id={id} className={`visually-hidden ${styles.accessibleName}`}>
        {name}
      </span>
      <span aria-hidden="true">
        <span className={styles.prefix}>{name.slice(0, cut)}</span>
        {breakable(name.slice(cut))}
      </span>
    </code>
  );
}

/** The short reason, on the name line ("Full set", "Offline"). */
function LockLabel({ info }: { info: BlockInfo }) {
  return (
    <span className={styles.lock}>
      <Icon name="lock" />
      {info.short}
    </span>
  );
}

/**
 * The full sentence. Visible unless a banner or the list's notice already says it; then it stays
 * in the DOM for assistive tech (and as the target of the row's `aria-describedby`).
 */
function Reason({ info, id }: { info: BlockInfo; id: string }) {
  return (
    <p id={id} className={info.explainedElsewhere ? "visually-hidden" : styles.reason}>
      {info.text}
    </p>
  );
}

/**
 * One parameter as a dense row: [name, badges, description, why it's blocked] [value or control]
 * [Read]. A param the gateway won't let you change shows its value as text, not a disabled
 * control. Reads only once on screen, or on demand.
 */
export function ParamRow({ command, context }: ParamRowProps) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref);
  const [requested, setRequested] = useState(false);
  const nameId = useId();
  const reasonId = useId();
  const readId = useId();

  const isAction = command.access === "action";
  const writable = command.access === "readwrite";
  const readBlock = blockInfo(command, "read", context);
  const writeBlock = writable ? blockInfo(command, "write", context) : null;
  const actionBlock = isAction ? blockInfo(command, "action", context) : null;
  const canRead = !isAction && readBlock === null;
  // Read is offered unless the gateway refuses reads for this param outright; while waiting or
  // offline it stays, disabled, so rows don't shift when the condition clears.
  const offersRead = !isAction && !command.blocked.read;

  const reading = useParam(command.name, { enabled: canRead && (inView || requested) });
  const write = useWriteParam(command.name);
  const pending = useWritePending(command.name);
  const value = reading.data?.value;
  const hint = unitHint(value, command.unit);
  const block =
    (isAction ? actionBlock : writable ? writeBlock : null) ?? (isAction ? null : readBlock);
  const describedBy = block ? { describedBy: reasonId } : {};

  const read = () => {
    if (requested || inView) void reading.refetch();
    else setRequested(true);
  };

  return (
    <li className={styles.row} ref={ref}>
      <div className={styles.ident}>
        <div className={styles.head}>
          <ParamName name={command.name} id={nameId} />
          {block && <LockLabel info={block} />}
          {command.access === "readonly" && <span className={styles.badge}>Read-only</span>}
          {isAction && <span className={styles.badge}>Action</span>}
          {command.source === "help" && <span className={styles.badge}>Raw</span>}
          {command.availability === "missing" && (
            <span className={`${styles.badge} ${styles.badgeWarn}`}>Not in help</span>
          )}
          {command.destructive && (
            <span className={`${styles.badge} ${styles.badgeDanger}`}>Destructive</span>
          )}
        </div>
        {(command.description || command.aliases.length > 0) && (
          <p className={styles.description}>
            {command.description}
            {command.aliases.length > 0 && (
              <span className={styles.aliases}>
                {command.description ? " · " : ""}
                Alias {command.aliases.join(", ")}
              </span>
            )}
          </p>
        )}
        {block && <Reason info={block} id={reasonId} />}
      </div>
      <div className={styles.body}>
        {isAction ? (
          <ActionButton command={command} reason={actionBlock?.text ?? null} {...describedBy} />
        ) : writable && writeBlock === null ? (
          <ParamControl
            schema={command.schema}
            value={value}
            disabled={value === undefined}
            pending={pending}
            labelledBy={nameId}
            onCommit={(next) => write.mutateAsync({ value: next }).catch(() => {})}
          />
        ) : (
          <span className={offersRead ? styles.value : styles.unreadable}>
            {!offersRead ? "Not readable" : value === undefined ? "–" : String(value)}
          </span>
        )}
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      {offersRead && (
        <button
          type="button"
          className={`${controls.button} ${controls.small} ${styles.read}`}
          id={readId}
          disabled={!canRead || reading.isFetching}
          aria-labelledby={`${readId} ${nameId}`}
          aria-describedby={block ? reasonId : undefined}
          onClick={read}
        >
          {reading.isFetching ? "Reading…" : reading.data ? "Refresh" : "Read"}
        </button>
      )}
      <div className={styles.problems}>
        <ProblemMessage error={write.error ?? reading.error} />
      </div>
    </li>
  );
}
