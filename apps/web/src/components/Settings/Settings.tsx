import { useId } from "react";
import { useDevice, useToken } from "../../api/hooks.ts";
import { ProcessorFacts } from "../ProcessorFacts/ProcessorFacts.tsx";
import { AuthControl } from "../StatusBar/components/AuthControl/AuthControl.tsx";
import styles from "./Settings.module.css";

/** The processor's facts in full, and the API token. */
export function Settings() {
  const { data: device } = useDevice();
  const token = useToken();
  const headingId = useId();
  const accessId = useId();
  return (
    <div className={styles.settings}>
      <section aria-labelledby={headingId}>
        <h2 className={styles.heading} id={headingId}>
          Processor
        </h2>
        <ProcessorFacts />
      </section>
      <section aria-labelledby={accessId}>
        <h2 className={styles.heading} id={accessId}>
          Access
        </h2>
        {device?.authRequired ? (
          <div className={styles.access}>
            <p className={styles.note}>
              This gateway needs an API token for changes.{" "}
              {token ? "A token is set for this tab." : "No token is set."}
            </p>
            <AuthControl />
          </div>
        ) : (
          <p className={styles.note}>This gateway doesn't need an API token.</p>
        )}
      </section>
    </div>
  );
}
