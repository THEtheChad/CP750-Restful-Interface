import type { useWriteParam } from "../../../../../../../../api/hooks.ts";
import type { Command, ParamValue } from "../../../../../../../../api/types.ts";
import type { ParamFunction } from "../../../../../../../../lib/param-function.ts";
import { ChoiceGroup } from "../../../../../../../ChoiceGroup/ChoiceGroup.tsx";
import { ToggleButton } from "../../../../../../../ToggleButton/ToggleButton.tsx";
import { ParamControl } from "../ParamControl/ParamControl.tsx";
import { LevelControl } from "./components/LevelControl/LevelControl.tsx";

export interface ParamSurfaceProps {
  command: Command;
  fn: ParamFunction;
  value: ParamValue | undefined;
  db: number | undefined;
  pending: boolean;
  /** Id of the element naming the param. */
  nameId: string;
  /** The row's write, so the row shows its errors. */
  write: ReturnType<typeof useWriteParam>;
}

/**
 * A writable param's control, chosen by what it does (`functionOf`), so it matches the main
 * controls: levels step like the fader, 0/1 params toggle like mute, short enums choose like the
 * input selector. Entries and long lists edit a draft sent with Set.
 */
export function ParamSurface({
  command,
  fn,
  value,
  db,
  pending,
  nameId,
  write,
}: ParamSurfaceProps) {
  const unread = value === undefined;
  switch (fn.kind) {
    case "level":
      return (
        <LevelControl
          name={command.name}
          nameId={nameId}
          value={typeof value === "number" ? value : undefined}
          db={db}
          pending={pending}
        />
      );
    case "toggle":
      return (
        <ToggleButton
          size="desk"
          name={{ labelledBy: nameId }}
          vocabulary={fn.vocabulary}
          value={value}
          pending={pending}
          disabled={unread}
          onToggle={(next) => write.mutate({ value: next })}
        />
      );
    case "choice":
      if (fn.layout === "segments") {
        return (
          <ChoiceGroup
            size="desk"
            options={fn.options}
            current={value}
            pending={pending}
            disabled={unread}
            labelFor={String}
            labelledBy={nameId}
            onChoose={(next) => write.mutate({ value: next })}
          />
        );
      }
      break;
  }
  return (
    <ParamControl
      schema={command.schema}
      value={value}
      disabled={unread}
      labelledBy={nameId}
      onCommit={(next) => write.mutateAsync({ value: next }).catch(() => {})}
    />
  );
}
