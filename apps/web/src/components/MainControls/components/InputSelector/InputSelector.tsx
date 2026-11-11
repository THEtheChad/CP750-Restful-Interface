import { useQueries } from "@tanstack/react-query";
import { useId } from "react";
import {
  useApi,
  useCommands,
  useDevice,
  useParam,
  useParamAccess,
  useWriteParam,
  useWritePending,
} from "../../../../api/hooks.ts";
import { queryKeys } from "../../../../api/query-keys.ts";
import { formatFader } from "../../../../lib/fader.ts";
import { humanize } from "../../../../lib/labels.ts";
import { MAIN_PARAMS } from "../../../../lib/param-function.ts";
import { BlockedNote } from "../../../BlockedNote/BlockedNote.tsx";
import { ChoiceGroup } from "../../../ChoiceGroup/ChoiceGroup.tsx";
import { ProblemMessage } from "../../../ProblemMessage/ProblemMessage.tsx";
import section from "../../section.module.css";
import { StaleBadge } from "../StaleBadge/StaleBadge.tsx";

export const INPUT_PARAM = MAIN_PARAMS.input;

const formatValue = (value: unknown) => humanize(String(value));

/** Each input's fader preset param (`cp750.sys.fader_preset_<suffix>` and `…_enable`). */
const PRESET_SUFFIX: Record<string, string> = {
  analog: "a",
  dig_1: "1",
  dig_2: "2",
  dig_3: "3",
  dig_4: "4",
  mic: "m",
  non_sync: "n",
};

/**
 * The fader preset each input recalls, when its preset is enabled: read once and kept, since
 * presets change only in setup. Inputs without a readable, enabled preset get none.
 */
function usePresets(): ReadonlyMap<string, number> {
  const api = useApi();
  const commands = useCommands().data?.commands;
  const connected = useDevice().data?.connection === "connected";
  const entries = Object.entries(PRESET_SUFFIX);
  const names = entries.flatMap(([, s]) => [
    `cp750.sys.fader_preset_${s}`,
    `cp750.sys.fader_preset_${s}_enable`,
  ]);
  const readable = (name: string) => {
    const command = commands?.find((c) => c.name === name);
    return Boolean(connected && command && !command.blocked.read);
  };
  const results = useQueries({
    queries: names.map((name) => ({
      queryKey: queryKeys.param(name),
      queryFn: () => api.readParam(name),
      enabled: readable(name),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const presets = new Map<string, number>();
  entries.forEach(([input], i) => {
    const level = results[i * 2]?.data?.value;
    const enabled = results[i * 2 + 1]?.data?.value;
    if (enabled === 1 && typeof level === "number") presets.set(input, level);
  });
  return presets;
}

/** The input: the shared choice surface at glance size, one lamp key per enum value. */
export function InputSelector() {
  const access = useParamAccess(INPUT_PARAM);
  const reading = useParam(INPUT_PARAM, { enabled: access.read === null, live: true });
  const write = useWriteParam(INPUT_PARAM);
  const pending = useWritePending(INPUT_PARAM);
  const presets = usePresets();
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
        detailFor={(option) => {
          const level = presets.get(option);
          return level === undefined ? null : `Preset ${formatFader(level)}`;
        }}
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
