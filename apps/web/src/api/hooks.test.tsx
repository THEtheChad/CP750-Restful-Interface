import { describe, expect, test } from "bun:test";
import { act, waitFor } from "@testing-library/react";
import { createFakeGateway, deferred, problem } from "../../test/fake-gateway.ts";
import { renderWithGateway } from "../../test/render.tsx";
import { staleAfterMs, useParam, useWriteParam } from "./hooks.ts";
import { queryKeys } from "./query-keys.ts";
import type { ParamReading } from "./types.ts";

const INPUT = "cp750.sys.input_mode";
const at = "2026-11-10T12:00:00.000Z";

type Write = ReturnType<typeof useWriteParam>;

/** Hands `useWriteParam(INPUT)` out through `onWrite`. */
function Writer({ onWrite }: { onWrite: (write: Write) => void }) {
  // An observer, as on screen, so invalidation re-reads.
  useParam(INPUT, { enabled: true });
  onWrite(useWriteParam(INPUT));
  return null;
}

function renderWriter(gateway = createFakeGateway()) {
  const ref: { write?: Write } = {};
  const result = renderWithGateway(
    <Writer
      onWrite={(write) => {
        ref.write = write;
      }}
    />,
    { gateway },
  );
  const key = queryKeys.param(INPUT);
  const value = () => result.queryClient.getQueryData<ParamReading>(key)?.value;
  return { ...result, write: () => ref.write as Write, value };
}

/** Waits for the initial read, then forgets the requests so far. */
async function loaded(r: ReturnType<typeof renderWriter>, expected: string) {
  await waitFor(() => expect(r.value()).toBe(expected));
  r.gateway.requests.length = 0;
}

describe("useWriteParam", () => {
  test("a failed write rolls back only if the cache still holds its optimistic value", async () => {
    const gateway = createFakeGateway();
    const held = deferred<Response | undefined>();
    gateway.intercept((r) => (r.method === "PUT" ? held.promise : undefined));
    const r = renderWriter(gateway);
    const { write, value, queryClient } = r;
    await loaded(r, "dig_1");
    gateway.values.set(INPUT, "analog");

    const pending = write()
      .mutateAsync({ value: "dig_2" })
      .catch(() => {});
    await waitFor(() => expect(value()).toBe("dig_2"));
    // Something newer lands meanwhile (a re-read after a front-panel change).
    queryClient.setQueryData<ParamReading>(queryKeys.param(INPUT), {
      name: INPUT,
      value: "analog",
      raw: "analog",
    });
    held.resolve(problem(503, "NOT_CONNECTED"));
    await act(() => pending);
    // Not rolled back to dig_1: the newer value stays, and the param is re-read.
    expect(value()).toBe("analog");
    await waitFor(() =>
      expect(gateway.paramRequests("GET").map((r) => r.path)).toContain(`/api/params/${INPUT}`),
    );
  });

  test("with nothing newer, a failed write rolls back", async () => {
    const gateway = createFakeGateway();
    gateway.intercept((r) => (r.method === "PUT" ? problem(503, "NOT_CONNECTED") : undefined));
    const r = renderWriter(gateway);
    const { write, value } = r;
    await loaded(r, "dig_1");
    await act(() =>
      write()
        .mutateAsync({ value: "dig_2" })
        .catch(() => {}),
    );
    expect(value()).toBe("dig_1");
  });

  test("SSE events wait for the write, then a disagreeing one triggers a re-read", async () => {
    const gateway = createFakeGateway();
    const held = deferred<Response | undefined>();
    gateway.intercept((r) => (r.method === "PUT" ? held.promise : undefined));
    const r = renderWriter(gateway);
    const { write, value, events } = r;
    await loaded(r, "dig_1");
    events().open();

    const pending = write().mutateAsync({ value: "dig_2" });
    await waitFor(() => expect(value()).toBe("dig_2"));
    // The front panel switches to analog while our write is in flight: not applied yet.
    events().emit("param", { type: "param", name: INPUT, value: "analog", raw: "analog", at });
    expect(value()).toBe("dig_2");
    const reads = gateway.paramRequests("GET").length;
    held.resolve(undefined);
    await act(() => pending);
    // The held event disagrees with the result: the processor is asked again.
    await waitFor(() => expect(gateway.paramRequests("GET").length).toBe(reads + 1));
  });

  test("our own echo does not cause a re-read", async () => {
    const gateway = createFakeGateway();
    const held = deferred<Response | undefined>();
    gateway.intercept((r) => (r.method === "PUT" ? held.promise : undefined));
    const r = renderWriter(gateway);
    const { write, value, events } = r;
    await loaded(r, "dig_1");
    events().open();
    const pending = write().mutateAsync({ value: "dig_2" });
    await waitFor(() => expect(value()).toBe("dig_2"));
    events().emit("param", { type: "param", name: INPUT, value: "dig_2", raw: "dig_2", at });
    held.resolve(undefined);
    await act(() => pending);
    await new Promise((r) => setTimeout(r, 20));
    expect(gateway.paramRequests("GET")).toEqual([]);
    expect(value()).toBe("dig_2");
  });

  test("writes to one param run one at a time, in order", async () => {
    const gateway = createFakeGateway();
    const first = deferred<Response | undefined>();
    let puts = 0;
    gateway.intercept((request) => {
      if (request.method !== "PUT") return undefined;
      puts++;
      return puts === 1 ? first.promise : undefined;
    });
    const r = renderWriter(gateway);
    const { write, value } = r;
    await loaded(r, "dig_1");
    const a = write().mutateAsync({ value: "dig_2" });
    const b = write().mutateAsync({ value: "analog" });
    await new Promise((r) => setTimeout(r, 20));
    expect(gateway.paramRequests("PUT").length).toBe(1);
    first.resolve(undefined);
    await act(() => Promise.all([a, b]));
    expect(gateway.paramRequests("PUT").map((r) => r.body)).toEqual([
      { value: "dig_2" },
      { value: "analog" },
    ]);
    expect(value()).toBe("analog");
  });
});

describe("staleAfterMs", () => {
  test("a few poll intervals, at least 3 s; 10 s when polling is off", () => {
    expect(staleAfterMs(1_000)).toBe(3_000);
    expect(staleAfterMs(5_000)).toBe(15_000);
    expect(staleAfterMs(100)).toBe(3_000);
    expect(staleAfterMs(0)).toBe(10_000);
  });
});
