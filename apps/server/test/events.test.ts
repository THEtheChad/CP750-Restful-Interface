import { describe, expect, test } from "bun:test";
import { setup } from "./helpers.ts";

interface SseMessage {
  event?: string;
  id?: string;
  data?: string;
  comment?: string;
}

/** Reads SSE messages from a response body. */
function sseReader(res: Response) {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const queue: SseMessage[] = [];

  async function next(timeoutMs = 2000): Promise<SseMessage> {
    const deadline = Date.now() + timeoutMs;
    while (queue.length === 0) {
      const sep = buffer.indexOf("\n\n");
      if (sep >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const message: SseMessage = {};
        for (const line of block.split("\n")) {
          if (line.startsWith(":")) message.comment = line.slice(1).trim();
          const [, key, value] = /^(event|id|data): ?(.*)$/.exec(line) ?? [];
          if (key) message[key as "event" | "id" | "data"] = value;
        }
        queue.push(message);
        continue;
      }
      if (Date.now() > deadline) throw new Error("timed out waiting for an SSE message");
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buffer += decoder.decode(value, { stream: true });
    }
    return queue.shift() as SseMessage;
  }

  return { next, cancel: () => reader.cancel() };
}

async function until(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met");
    await Bun.sleep(5);
  }
}

describe("GET /api/events", () => {
  test("sends snapshots, forwards session events, and unsubscribes on abort", async () => {
    const { app, session } = await setup();
    let active = 0;
    const subscribe = session.subscribe.bind(session);
    session.subscribe = (listener) => {
      active++;
      const unsubscribe = subscribe(listener);
      return () => {
        active--;
        unsubscribe();
      };
    };

    const res = await app.request("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/event-stream");
    const sse = sseReader(res);

    const connection = await sse.next();
    expect(connection.event).toBe("connection");
    expect(JSON.parse(connection.data as string)).toMatchObject({
      type: "connection",
      connection: "connected",
      error: null,
    });
    const device = await sse.next();
    expect(device.event).toBe("device");
    expect(JSON.parse(device.data as string)).toMatchObject({
      type: "device",
      firmware: "1.0.0.150183",
      manifest: { match: "exact", verified: true },
    });
    expect(active).toBe(1);

    session.setDeviceValue("cp750.sys.fader", 42);
    const param = await sse.next();
    expect(param.event).toBe("param");
    expect(param.id).toBe("3");
    expect(JSON.parse(param.data as string)).toMatchObject({
      type: "param",
      name: "cp750.sys.fader",
      value: 42,
      raw: "42",
    });

    session.disconnect("cable pulled");
    const lost = await sse.next();
    expect(JSON.parse(lost.data as string)).toMatchObject({
      type: "connection",
      connection: "reconnecting",
      error: { message: "cable pulled" },
    });

    await sse.cancel();
    await until(() => active === 0);
  });

  test("sends heartbeat comments", async () => {
    const { app } = await setup({ app: { heartbeatMs: 10 } });
    const sse = sseReader(await app.request("/api/events"));
    await sse.next();
    await sse.next();
    expect((await sse.next()).comment).toBe("ping");
    await sse.cancel();
  });

  test("unsubscribes when the request is aborted", async () => {
    const { app, session } = await setup();
    let unsubscribed = false;
    const subscribe = session.subscribe.bind(session);
    session.subscribe = (listener) => {
      const unsubscribe = subscribe(listener);
      return () => {
        unsubscribed = true;
        unsubscribe();
      };
    };
    const controller = new AbortController();
    const res = await app.request("/api/events", { signal: controller.signal });
    const sse = sseReader(res);
    await sse.next();
    controller.abort();
    await until(() => unsubscribed);
  });
});
