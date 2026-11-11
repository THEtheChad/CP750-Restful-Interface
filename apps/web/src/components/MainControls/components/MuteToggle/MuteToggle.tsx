import { useId } from "react";
import { useParam, useParamAccess, useWriteParam, useWritePending } from "../../../../api/hooks.ts";
import { MAIN_PARAMS, MUTE_VOCABULARY } from "../../../../lib/param-function.ts";
import { BlockedNote } from "../../../BlockedNote/BlockedNote.tsx";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import { ToggleButton } from "../../../ToggleButton/ToggleButton.tsx";
import section from "../../section.module.css";
import { StaleBadge } from "../StaleBadge/StaleBadge.tsx";

export const MUTE_PARAM = MAIN_PARAMS.mute;

const formatValue = (value: unknown) => (Number(value) === 1 ? "muted" : "unmuted");

/**
 * Main mute: the shared toggle surface at glance size, named "Mute" with state in `aria-pressed`.
 * Disabled, with the reason, when the firmware/tier refuses it.
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
  const reason = access.write ?? (known ? null : access.read);

  return (
    <section className={section.section} aria-labelledby={headingId}>
      <h2 className="visually-hidden" id={headingId}>
        Mute
      </h2>
      <ToggleButton
        size="glance"
        name={{ label: "Mute" }}
        vocabulary={MUTE_VOCABULARY}
        value={value}
        pending={pending}
        disabled={access.write !== null}
        describedBy={reason ? reasonId : undefined}
        onToggle={(next) => write.mutate({ value: next })}
      />
      <StaleBadge name={MUTE_PARAM} />
      {reason && <BlockedNote id={reasonId}>{reason}</BlockedNote>}
      <ProblemMessage error={write.error} formatValue={formatValue} />
      {!write.error && access.read === null && <ProblemMessage error={reading.error} />}
    </section>
  );
}
