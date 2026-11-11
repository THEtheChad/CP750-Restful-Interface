import type { ApiError } from "../../api/problem.ts";
import type { ParamValue } from "../../api/types.ts";
import { describeProblem } from "../../lib/problem-text.ts";
import { Icon } from "../Icon/Icon.tsx";
import styles from "./ProblemMessage.module.css";

export interface ProblemMessageProps {
  error: ApiError | null | undefined;
  /** How to show values in `WRITE_REJECTED` (e.g. the fader as `7.0`). */
  formatValue?: (value: ParamValue) => string;
  id?: string;
}

/** A problem+json error as a readable alert: title, detail, and the stable code. */
export function ProblemMessage({ error, formatValue, id }: ProblemMessageProps) {
  if (!error) return null;
  const { title, detail, code } = describeProblem(error.problem, formatValue);
  return (
    <div className={styles.problem} role="alert" id={id}>
      <Icon name="alert" className={styles.icon} />
      <div>
        <strong className={styles.title}>
          {title}
          <span className={styles.code}>{code}</span>
        </strong>
        {detail && <p className={styles.detail}>{detail}</p>}
      </div>
    </div>
  );
}
