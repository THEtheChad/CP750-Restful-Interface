import controls from "../../styles/controls.module.css";
import { Icon } from "../Icon/Icon.tsx";
import styles from "./BlockedNote.module.css";

/** Why a control is disabled, with a lock. Referenced by the control's `aria-describedby`. */
export function BlockedNote({ id, children }: { id: string; children: string }) {
  return (
    <p className={`${controls.reason} ${styles.note}`}>
      <Icon name="lock" className={styles.icon} />
      <span id={id}>{children}</span>
    </p>
  );
}
