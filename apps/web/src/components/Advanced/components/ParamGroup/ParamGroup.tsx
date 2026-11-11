import { useId } from "react";
import type { Command } from "../../../../api/types.ts";
import type { BlockContext } from "../../../../lib/reasons.ts";
import { Icon } from "../../../Icon/Icon.tsx";
import { ParamRow } from "./components/ParamRow/ParamRow.tsx";
import styles from "./ParamGroup.module.css";

export interface ParamGroupProps {
  /** The names it covers, e.g. `cp750.sys.eq_l_*`. */
  prefix: string;
  label: string;
  commands: Command[];
  context: BlockContext;
  expanded: boolean;
  /** Without it the group is always expanded (while filtering). */
  onToggle?: () => void;
}

/** One section of the list (a namespace, or a group of `sys`). Rows are only rendered (and so only read) while expanded. */
export function ParamGroup({
  prefix,
  label,
  commands,
  context,
  expanded,
  onToggle,
}: ParamGroupProps) {
  const listId = useId();
  const inner = (
    <>
      {onToggle && <Icon name="chevron" className={styles.chevron} />}
      <span>{label}</span>
      <span className={styles.prefix}>{prefix}</span>
      <span className={styles.count}>
        {commands.length}
        <span className="visually-hidden"> parameters</span>
      </span>
    </>
  );
  return (
    <section className={styles.group}>
      <h3 className={styles.heading}>
        {onToggle ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={onToggle}
          >
            {inner}
          </button>
        ) : (
          <span className={styles.title}>{inner}</span>
        )}
      </h3>
      {expanded && (
        <ul className={styles.list} id={listId}>
          {commands.map((c) => (
            <ParamRow key={c.name} command={c} context={context} />
          ))}
        </ul>
      )}
    </section>
  );
}
