import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { FakeEventSource } from "../../test/fake-gateway.ts";
import { fixtureDevice } from "../../test/fixtures.ts";
import { applySessionEvent, connectEvents } from "./events.ts";
import { queryKeys } from "./query-keys.ts";
import type { Device, ParamReading } from "./types.ts";

const at = "2026-11-10T12:00:00.000Z";

describe("SSE → query cache", () => {
  test("a param event updates the cached reading", () => {
    const qc = new QueryClient();
    qc.setQueryData<ParamReading>(queryKeys.param("cp750.sys.input_mode"), {
      name: "cp750.sys.input_mode",
      value: "analog",
      raw: "analog",
    });
    applySessionEvent(qc, {
      type: "param",
      name: "cp750.sys.input_mode",
      value: "dig_2",
      raw: "dig_2",
      at,
    });
    expect(qc.getQueryData(queryKeys.param("cp750.sys.input_mode"))).toEqual({
      name: "cp750.sys.input_mode",
      value: "dig_2",
      raw: "dig_2",
    });
  });

  test("a fader change drops the stale dB and re-reads it from the API", () => {
    const qc = new QueryClient();
    const key = queryKeys.param("cp750.sys.fader");
    qc.setQueryData<ParamReading>(key, {
      name: "cp750.sys.fader",
      value: 70,
      raw: "70",
      unit: "fader",
      db: 0,
    });
    applySessionEvent(qc, { type: "param", name: "cp750.sys.fader", value: 40, raw: "40", at });
    const reading = qc.getQueryData<ParamReading>(key);
    expect(reading).toEqual({ name: "cp750.sys.fader", value: 40, raw: "40", unit: "fader" });
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
  });

  test("an unchanged value keeps dB and doesn't re-read (our own write's echo)", () => {
    const qc = new QueryClient();
    const key = queryKeys.param("cp750.sys.fader");
    qc.setQueryData<ParamReading>(key, {
      name: "cp750.sys.fader",
      value: 70,
      raw: "70",
      unit: "fader",
      db: 0,
    });
    applySessionEvent(qc, { type: "param", name: "cp750.sys.fader", value: 70, raw: "70", at });
    expect(qc.getQueryData<ParamReading>(key)?.db).toBe(0);
    expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
  });

  test("connection and device events update the device and refresh the command list", () => {
    const qc = new QueryClient();
    qc.setQueryData<Device>(queryKeys.device, fixtureDevice());
    qc.setQueryData(queryKeys.commands, { commands: [] });
    const error = { code: "ECONNREFUSED", message: "connection refused" };
    applySessionEvent(qc, { type: "connection", connection: "reconnecting", error, at });
    expect(qc.getQueryData<Device>(queryKeys.device)?.connection).toBe("reconnecting");
    expect(qc.getQueryData<Device>(queryKeys.device)?.lastError).toEqual(error);

    const manifest = {
      firmware: "1.2.8",
      status: "draft" as const,
      match: "nearest" as const,
      verified: false,
    };
    applySessionEvent(qc, { type: "device", firmware: "1.2.9", manifest, at });
    expect(qc.getQueryData<Device>(queryKeys.device)?.manifest).toEqual(manifest);
    expect(qc.getQueryState(queryKeys.commands)?.isInvalidated).toBe(true);
  });
});

describe("event stream", () => {
  function setup() {
    FakeEventSource.reset();
    const qc = new QueryClient();
    const statuses: string[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const close = connectEvents({
      url: "/api/events",
      queryClient: qc,
      createEventSource: (url) => new FakeEventSource(url),
      onStatus: (s) => statuses.push(s),
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return () => {};
      },
    });
    return { qc, statuses, timers, close };
  }

  test("routes named events into the cache through one EventSource", () => {
    const { qc } = setup();
    expect(FakeEventSource.instances.length).toBe(1);
    FakeEventSource.latest.open();
    FakeEventSource.latest.emit("param", {
      type: "param",
      name: "cp750.sys.mute",
      value: 1,
      raw: "1",
      at,
    });
    expect(qc.getQueryData<ParamReading>(queryKeys.param("cp750.sys.mute"))?.value).toBe(1);
  });

  test("reconnects with exponential backoff, capped, and resyncs on reopen", () => {
    const { qc, statuses, timers, close } = setup();
    qc.setQueryData<Device>(queryKeys.device, fixtureDevice());
    for (let i = 0; i < 7; i++) {
      FakeEventSource.latest.fail();
      expect(FakeEventSource.latest.closed).toBe(true);
      timers.at(-1)?.fn();
    }
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(FakeEventSource.instances.length).toBe(8);

    FakeEventSource.latest.open();
    expect(statuses.at(-1)).toBe("open");
    expect(qc.getQueryState(queryKeys.device)?.isInvalidated).toBe(true);

    // After a successful open the backoff starts over.
    FakeEventSource.latest.fail();
    expect(timers.at(-1)?.ms).toBe(1000);
    close();
    expect(FakeEventSource.latest.closed).toBe(true);
  });
});
