import { useId } from "react";
import { useParam, useParamAccess, useWriteParam, useWritePending } from "../../../../api/hooks.ts";
import { humanize } from "../../../../lib/labels.ts";
import { MAIN_PARAMS } from "../../../../lib/param-function.ts";
import { BlockedNote } from "../../../BlockedNote/BlockedNote.tsx";
import { ChoiceGroup } from "../../../ChoiceGroup/ChoiceGroup.tsx";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import section from "../../section.module.css";
import { StaleBadge } from "../StaleBadge/StaleBadge.tsx";

export const INPUT_PARAM = MAIN_PARAMS.input;

const formatValue = (value: unknown) => humanize(String(value));

/** The input: the shared choice surface at glance size, one button per enum value. */
export function InputSelector() {
  const access = useParamAccess(INPUT_PARAM);
  const reading = useParam(INPUT_PARAM, { enabled: access.read === null, live: true });
  const write = useWriteParam(INPUT_PARAM);
  const pending = useWritePending(INPUT_PARAM);
  const headingId = useId();
  const reasonId = useId();
  const options = (access.command?.schema?.enum ?? []).map(String);

  return (
    <section className={section.section} aria-labelledby={headingId}>
      <div className={section.header}>
        <h2 className={section.heading} id={headingId}>
          Input
        </h2>
        <StaleBadge name={INPUT_PARAM} />
      </div>
      <ChoiceGroup
        size="glance"
        options={options}
        current={reading.data?.value}
        pending={pending}
        pendingWord="Switching…"
        disabled={access.write !== null}
        labelFor={humanize}
        labelledBy={headingId}
        describedBy={access.write ? reasonId : undefined}
        onChoose={(value) => write.mutate({ value })}
      />
      {access.write && <BlockedNote id={reasonId}>{access.write}</BlockedNote>}
      <ProblemMessage error={write.error} formatValue={formatValue} />
      {!write.error && <ProblemMessage error={reading.error} />}
    </section>
  );
}
