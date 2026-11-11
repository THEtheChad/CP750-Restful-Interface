import { useId } from "react";
import { useFreshness } from "../../../../api/hooks.ts";
import styles from "./StaleBadge.module.css";

/**
 * "Stale" next to a main control's heading when its value may no longer match the processor
 * (see `useFreshness`), with the reason as text for screen readers and as a tooltip.
 */
export function StaleBadge({ name }: { name: string }) {
  const { stale, reason } = useFreshness(name);
  const reasonId = useId();
  if (!stale) return null;
  return (
    <span className={styles.badge} title={reason ?? undefined} aria-describedby={reasonId}>
      Stale
      <span id={reasonId} className="visually-hidden">
        {reason}
      </span>
    </span>
  );
}
