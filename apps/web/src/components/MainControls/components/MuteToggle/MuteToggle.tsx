import { useId } from "react";
import { useParam, useParamAccess, useWriteParam } from "../../../../api/hooks.ts";
import controls from "../../../../styles/controls.module.css";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import card from "../../card.module.css";
import styles from "./MuteToggle.module.css";

export const MUTE_PARAM = "cp750.sys.mute";

const formatValue = (value: unknown) => (Number(value) === 1 ? "muted" : "unmuted");

/** Main mute as a toggle button. Disabled, with the reason, when the firmware/tier refuses it. */
export function MuteToggle() {
  const access = useParamAccess(MUTE_PARAM);
  const reading = useParam(MUTE_PARAM, { enabled: access.read === null, live: true });
  const write = useWriteParam(MUTE_PARAM);
  const headingId = useId();
  const reasonId = useId();
  const value = reading.data?.value;
  const known = value === 0 || value === 1;
  const muted = value === 1;
  const reason = access.write ?? (known ? null : access.read);

  return (
    <section className={card.card} aria-labelledby={headingId}>
      <h2 className={card.heading} id={headingId}>
        Mute
      </h2>
      <button
        type="button"
        className={styles.mute}
        aria-pressed={known ? muted : undefined}
        disabled={access.write !== null || !known}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => write.mutate({ value: muted ? 0 : 1 })}
      >
        <span>Mute</span>
        <span className={styles.state} aria-hidden="true">
          {known ? (muted ? "On" : "Off") : "–"}
        </span>
      </button>
      {reason && (
        <p className={controls.reason} id={reasonId}>
          {reason}
        </p>
      )}
      <ProblemMessage error={write.error} formatValue={formatValue} />
      {!write.error && access.read === null && <ProblemMessage error={reading.error} />}
    </section>
  );
}
