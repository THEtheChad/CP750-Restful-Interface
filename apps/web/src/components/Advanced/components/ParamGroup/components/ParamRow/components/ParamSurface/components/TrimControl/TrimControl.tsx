import { useState } from "react";
import type { useWriteParam } from "../../../../../../../../../../api/hooks.ts";
import type { Command, ParamValue } from "../../../../../../../../../../api/types.ts";
import { useLatestSender } from "../../../../../../../../../../hooks/useLatestSender.ts";
import { TRIM_GESTURE_LIMIT } from "../../../../../../../../../../lib/param-function.ts";
import { Knob } from "../../../../../../../../../Knob/Knob.tsx";
import { ParamControl } from "../../../ParamControl/ParamControl.tsx";
import styles from "./TrimControl.module.css";

export interface TrimControlProps {
  command: Command;
  min: number;
  max: number;
  value: ParamValue | undefined;
  nameId: string;
  write: ReturnType<typeof useWriteParam>;
}

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");

/**
 * A bipolar trim: the knob (live, throttled to the newest value, at most `TRIM_GESTURE_LIMIT`
 * per gesture) and, beside it, typed entry sent with Set for exact or larger changes.
 */
export function TrimControl({ command, min, max, value, nameId, write }: TrimControlProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const sender = useLatestSender<number>(
    async (v) => {
      try {
        await write.mutateAsync({ value: v });
      } catch {
        sender.cancel();
        setDragValue(null);
      }
    },
    { onIdle: () => setDragValue(null) },
  );
  const current = typeof value === "number" ? value : undefined;
  const shown = dragValue ?? current;
  return (
    <div className={styles.trim}>
      <Knob
        value={shown}
        min={min}
        max={max}
        disabled={current === undefined}
        gestureLimit={TRIM_GESTURE_LIMIT}
        labelledBy={nameId}
        valueText={
          shown === undefined
            ? "not read"
            : `${signed(shown)}${dragValue !== null ? ", setting" : ""}`
        }
        onChange={(v) => {
          setDragValue(v);
          sender.push(v);
        }}
        onRelease={() => sender.flush()}
        onCancel={() => {
          sender.cancel();
          setDragValue(null);
        }}
      />
      <span className={styles.readout} aria-hidden="true">
        {shown === undefined ? "–" : signed(shown)}
      </span>
      <ParamControl
        schema={command.schema}
        value={value}
        disabled={current === undefined}
        labelledBy={nameId}
        slider={false}
        onCommit={(next) => write.mutateAsync({ value: next }).catch(() => {})}
      />
    </div>
  );
}
