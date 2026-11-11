import { useQueries } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import {
  useApi,
  useCommands,
  useDevice,
  useToken,
  useWriteParam,
  useWritePending,
} from "../../api/hooks.ts";
import { queryKeys } from "../../api/query-keys.ts";
import type { Command } from "../../api/types.ts";
import { useLatestSender } from "../../hooks/useLatestSender.ts";
import {
  eqBandOf,
  eqChannelLabel,
  eqChannelRank,
  formatHz,
  sysGroupOf,
} from "../../lib/param-groups.ts";
import { blockInfo } from "../../lib/reasons.ts";
import controls from "../../styles/controls.module.css";
import { Icon } from "../Icon/Icon.tsx";
import { ProblemMessage } from "../ProblemMessage/ProblemMessage.tsx";
import { BandDock } from "./components/BandDock/BandDock.tsx";
import { EqCurve } from "./components/EqCurve/EqCurve.tsx";
import styles from "./Equalizer.module.css";

interface Band {
  command: Command;
  hz: number;
}

const keyLabel = (channel: string) => (channel === "lfe" ? "LFE" : eqChannelLabel(channel));

/**
 * The equalizer, one channel at a time, drawn the Pro-Q way (a curve you work on directly) over
 * the processor's third-octave bands. Inspection by default: "Edit EQ" turns on changes for the
 * selected channel only, one band at a time; drags are throttled to the newest value with one
 * write in flight. Values are the processor's raw integers (the unit isn't documented). The List
 * view is the plain, screen-reader-friendly alternative.
 */
export function Equalizer() {
  const api = useApi();
  const commandsQuery = useCommands();
  const { data: device } = useDevice();
  const token = useToken();
  const context = useMemo(() => ({ device, hasToken: token !== null }), [device, token]);
  const headingId = useId();

  // EQ params by channel, bands sorted low to high; params without a band (LFE's parametric cut,
  // freq and Q) are listed separately.
  const { channels, byChannel, extras } = useMemo(() => {
    const byChannel = new Map<string, Band[]>();
    const extras = new Map<string, Command[]>();
    for (const command of commandsQuery.data?.commands ?? []) {
      if (sysGroupOf(command.name)?.key !== "eq") continue;
      const band = eqBandOf(command.name);
      if (!band) continue;
      if (band.hz === null)
        extras.set(band.channel, [...(extras.get(band.channel) ?? []), command]);
      else
        byChannel.set(band.channel, [
          ...(byChannel.get(band.channel) ?? []),
          { command, hz: band.hz },
        ]);
    }
    for (const list of byChannel.values()) list.sort((a, b) => a.hz - b.hz);
    const channels = [...new Set([...byChannel.keys(), ...extras.keys()])].sort(
      (a, b) => eqChannelRank(a) - eqChannelRank(b) || a.localeCompare(b),
    );
    return { channels, byChannel, extras };
  }, [commandsQuery.data]);

  const [chosen, setChosen] = useState<string | null>(null);
  const channel = chosen && channels.includes(chosen) ? chosen : (channels[0] ?? null);
  const bands = channel ? (byChannel.get(channel) ?? []) : [];
  const [chosenBand, setBand] = useState(14);
  const selected = Math.max(0, Math.min(bands.length - 1, chosenBand));
  const [armed, setArmed] = useState(false);
  const [mode, setMode] = useState<"curve" | "list">("curve");
  const [dragValue, setDragValue] = useState<number | null>(null);

  const readBlocks = bands.map((b) => blockInfo(b.command, "read", context));
  const readings = useQueries({
    queries: bands.map((b, i) => ({
      queryKey: queryKeys.param(b.command.name),
      queryFn: () => api.readParam(b.command.name),
      enabled: readBlocks[i] === null,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const values = readings.map((r) =>
    typeof r.data?.value === "number" ? r.data.value : undefined,
  );

  const current = bands[selected];
  const currentName = current?.command.name ?? "";
  const write = useWriteParam(currentName);
  const pending = useWritePending(currentName);
  const writeBlock = current ? blockInfo(current.command, "write", context) : null;
  const schema = current?.command.schema;
  const min =
    schema && "minimum" in schema && typeof schema.minimum === "number" ? schema.minimum : -60;
  const max =
    schema && "maximum" in schema && typeof schema.maximum === "number" ? schema.maximum : 60;
  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  const sender = useLatestSender<number>(
    async (value) => {
      try {
        await write.mutateAsync({ value });
      } catch {
        // The error shows under the dock; stop the drag where the processor is.
        sender.cancel();
        setDragValue(null);
      }
    },
    { onIdle: () => setDragValue(null) },
  );

  const canChange = armed && writeBlock === null && values[selected] !== undefined;
  const select = (index: number) => {
    sender.cancel();
    setDragValue(null);
    setBand(index);
  };
  const chooseChannel = (next: string) => {
    sender.cancel();
    setDragValue(null);
    setArmed(false);
    setChosen(next);
  };

  if (commandsQuery.isSuccess && channels.length === 0) {
    return (
      <section className={styles.eq} aria-labelledby={headingId}>
        <h2 className={styles.heading} id={headingId}>
          Equalizer
        </h2>
        <p className={styles.note}>This firmware's manifest has no equalizer parameters.</p>
      </section>
    );
  }

  const fullTier = readBlocks.length > 0 && readBlocks.every((b) => b?.code === "full-tier");
  const fullTierText = readBlocks[0]?.text;
  const channelExtras = channel ? (extras.get(channel) ?? []) : [];

  return (
    <section className={styles.eq} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 className={styles.heading} id={headingId}>
          Equalizer
        </h2>
        {/* biome-ignore lint/a11y/useSemanticElements: a row of keys, not a form fieldset. */}
        <div className={styles.keyrow} role="group" aria-label="Channel">
          {channels.map((c) => (
            <button
              key={c}
              type="button"
              className={`${controls.button} ${controls.small} ${styles.key}`}
              aria-pressed={c === channel}
              onClick={() => chooseChannel(c)}
            >
              {keyLabel(c)}
            </button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a row of keys, not a form fieldset. */}
        <div className={styles.keyrow} role="group" aria-label="View">
          {(["curve", "list"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`${controls.button} ${controls.small} ${styles.key}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === "curve" ? "Curve" : "List"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${controls.button} ${controls.small} ${styles.arm}`}
          aria-pressed={armed}
          disabled={bands.length === 0 || fullTier}
          onClick={() => {
            sender.cancel();
            setDragValue(null);
            setArmed((a) => !a);
          }}
        >
          <span
            className={armed ? `${controls.lamp} ${controls.lampOn}` : controls.lamp}
            aria-hidden="true"
          />
          Edit EQ
        </button>
      </div>

      {fullTier ? (
        <div className={`${controls.tray} ${styles.locked}`}>
          <Icon name="lock" />
          <p>The equalizer needs the CP750's full command set. {fullTierText}</p>
        </div>
      ) : bands.length === 0 ? (
        <p className={styles.note}>
          {channel ? `${keyLabel(channel)} has no third-octave bands.` : ""}
        </p>
      ) : mode === "curve" ? (
        <>
          <EqCurve
            bands={bands.map((b, i) => ({
              name: b.command.name,
              hz: b.hz,
              value: values[i],
              pending: i === selected && pending,
            }))}
            selected={selected}
            min={min}
            max={max}
            armed={canChange}
            draggable={
              typeof window === "undefined" || !window.matchMedia?.("(max-width: 43.75rem)").matches
            }
            dragValue={dragValue}
            label={`Equalizer, ${channel ? eqChannelLabel(channel) : ""}, ${bands.length} bands`}
            onSelect={select}
            onChange={(v) => {
              if (!canChange) return;
              setDragValue(v);
              sender.push(v);
            }}
            onRelease={() => sender.flush()}
          />
          {/* biome-ignore lint/a11y/useSemanticElements: a row of keys, not a form fieldset. */}
          <div className={styles.chips} role="group" aria-label="Band">
            {bands.map((b, i) => (
              <button
                key={b.command.name}
                type="button"
                className={`${controls.button} ${controls.small} ${styles.chip}`}
                aria-pressed={i === selected}
                onClick={() => select(i)}
              >
                {formatHz(b.hz)}
              </button>
            ))}
          </div>
          {current && (
            <BandDock
              hz={current.hz}
              index={selected}
              count={bands.length}
              value={dragValue ?? values[selected]}
              pending={pending || dragValue !== null}
              armed={armed}
              blocked={writeBlock?.text ?? null}
              onPrev={() => select(selected - 1)}
              onNext={() => select(selected + 1)}
              onStep={(delta) => {
                const v = values[selected];
                if (v !== undefined && canChange) write.mutate({ value: clamp(v + delta) });
              }}
              onSetZero={() => canChange && write.mutate({ value: 0 })}
            />
          )}
          <ProblemMessage error={write.error} />
        </>
      ) : (
        <table className={styles.list}>
          <thead>
            <tr>
              <th scope="col">Band</th>
              <th scope="col">Parameter</th>
              <th scope="col">Raw value</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={b.command.name} aria-current={i === selected || undefined}>
                <td>{formatHz(b.hz)}</td>
                <td>
                  <code>{b.command.name}</code>
                </td>
                <td className={styles.num}>
                  {values[i] ?? (readBlocks[i] ? readBlocks[i]?.short : "–")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {channelExtras.length > 0 && (
        <p className={styles.note}>
          {keyLabel(channel ?? "")} also has{" "}
          {channelExtras.map((c) => c.name.split(".").pop()).join(", ")}: change them under Advanced
          → Equalizer.
        </p>
      )}
      <p className={styles.note}>
        Band values are the processor's raw integers ({min} to {max}). Their unit isn't documented
        yet, so nothing here claims dB.
      </p>
    </section>
  );
}
