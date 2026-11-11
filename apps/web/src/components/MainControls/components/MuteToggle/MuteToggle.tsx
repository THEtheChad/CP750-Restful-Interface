import { useId } from "react";
import { useParam, useParamAccess, useWriteParam, useWritePending } from "../../../../api/hooks.ts";
import { BlockedNote } from "../../../BlockedNote/BlockedNote.tsx";
import { Icon } from "../../../Icon/Icon.tsx";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import section from "../../section.module.css";
import { StaleBadge } from "../StaleBadge/StaleBadge.tsx";
import styles from "./MuteToggle.module.css";

export const MUTE_PARAM = "cp750.sys.mute";

const formatValue = (value: unknown) => (Number(value) === 1 ? "muted" : "unmuted");

/**
 * Main mute as a toggle button whose accessible name is always "Mute" (state is `aria-pressed`).
 * Disabled, with the reason, when the firmware/tier refuses it, and while a mute write is pending
 * (so a double click cannot send two). Pending uses `aria-disabled` so the button keeps keyboard
 * focus. The solid "Muted" fill only shows once the processor has confirmed it.
 */
export function MuteToggle() {
  const access = useParamAccess(MUTE_PARAM);
  const reading = useParam(MUTE_PARAM, { enabled: access.read === null, live: true });
  const write = useWriteParam(MUTE_PARAM);
  const pending = useWritePending(MUTE_PARAM);
  const headingId = useId();
  const reasonId = useId();
  const value = reading.data?.value;
  const known = value === 0 || value === 1;
  const muted = value === 1;
  const reason = access.write ?? (known ? null : access.read);
  // While pending, `value` is already the optimistic target.
  const state = !known
    ? "Unknown"
    : pending
      ? muted
        ? "Muting…"
        : "Unmuting…"
      : muted
        ? "Muted"
        : "Audio on";
  const tone = !known ? undefined : pending ? "pending" : muted ? "muted" : "on";

  return (
    <section className={section.section} aria-labelledby={headingId}>
      <h2 className="visually-hidden" id={headingId}>
        Mute
      </h2>
      <button
        type="button"
        className={styles.mute}
        data-tone={tone}
        aria-pressed={known ? muted : undefined}
        disabled={access.write !== null || !known}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => {
          if (!pending) write.mutate({ value: muted ? 0 : 1 });
        }}
      >
        <Icon name={muted ? "speakerOff" : "speaker"} className={styles.icon} />
        <span className={styles.label}>Mute</span>
        <span className={styles.state} aria-hidden="true">
          {state}
        </span>
      </button>
      <StaleBadge name={MUTE_PARAM} />
      {reason && <BlockedNote id={reasonId}>{reason}</BlockedNote>}
      <ProblemMessage error={write.error} formatValue={formatValue} />
      {!write.error && access.read === null && <ProblemMessage error={reading.error} />}
    </section>
  );
}
