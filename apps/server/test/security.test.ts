import { describe, expect, test } from "bun:test";
import { escapeControl } from "../src/app.ts";
import { allowedHostNames, hostFromHeader, MAX_BODY_BYTES } from "../src/guards.ts";
import { json, post, put, setup } from "./helpers.ts";

function withHost(path: string, host: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

/** Mutating requests the device actually received (reads end in `?`). */
const writes = (sent: readonly string[]) => sent.filter((l) => !l.endsWith("?"));

describe("Host allow-list (DNS rebinding)", () => {
  test("answers localhost, 127.0.0.1 and [::1] on any port", async () => {
    const { app } = await setup();
    for (const host of ["localhost", "localhost:2222", "127.0.0.1:80", "[::1]:2222", "LOCALHOST"]) {
      expect((await app.request(withHost("/api/health", host))).status).toBe(200);
    }
  });

  test("refuses any other Host with 421 problem+json, for reads, SSE and the web client", async () => {
    const { app, session } = await setup();
    let subscribed = 0;
    const subscribe = session.subscribe.bind(session);
    session.subscribe = (listener) => {
      subscribed++;
      return subscribe(listener);
    };
    for (const path of ["/api/device", "/api/params/cp750.sys.fader", "/api/events", "/"]) {
      const res = await app.request(withHost(path, "rebind.evil.example:2222"));
      expect(res.status).toBe(421);
      expect(res.headers.get("content-type")).toBe("application/problem+json");
      expect(await json(res)).toMatchObject({ code: "HOST_NOT_ALLOWED", status: 421 });
    }
    const write = await app.request(
      withHost("/api/params/cp750.sys.fader", "rebind.evil.example", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: 100 }),
      }),
    );
    expect(write.status).toBe(421);
    expect(subscribed).toBe(0);
    expect(writes(session.sent)).toEqual([]);
    // Malformed Host headers are refused too.
    const malformed = new Request("http://localhost/api/health", {
      headers: { host: "localhost:x" },
    });
    expect((await app.request(malformed)).status).toBe(421);
  });

  test("adds the listen host and CP750_ALLOWED_HOSTS", async () => {
    const { app } = await setup({
      env: { CP750_LISTEN_HOST: "192.168.1.20", CP750_ALLOWED_HOSTS: "booth-pc.local" },
    });
    expect((await app.request(withHost("/api/health", "192.168.1.20:2222"))).status).toBe(200);
    expect((await app.request(withHost("/api/health", "Booth-PC.local:2222"))).status).toBe(200);
    expect((await app.request(withHost("/api/health", "192.168.1.21:2222"))).status).toBe(421);
  });

  test("on a wildcard listen address, the machine's interface addresses", () => {
    const names = allowedHostNames({ listenHost: "0.0.0.0", allowedHosts: [] }, () => [
      "10.0.0.7",
      "[fe80::1]",
    ]);
    expect([...names].sort()).toEqual(["10.0.0.7", "127.0.0.1", "[::1]", "[fe80::1]", "localhost"]);
    expect(names.has("0.0.0.0")).toBe(false);
  });

  test("hostFromHeader", () => {
    expect(hostFromHeader("Example.COM:8080")).toBe("example.com");
    expect(hostFromHeader("[::1]:2222")).toBe("[::1]");
    expect(hostFromHeader("[::1]")).toBe("[::1]");
    expect(hostFromHeader("127.0.0.1")).toBe("127.0.0.1");
    expect(hostFromHeader("::1")).toBeNull();
    expect(hostFromHeader("a:b:c")).toBeNull();
    expect(hostFromHeader("[::1")).toBeNull();
    expect(hostFromHeader("localhost:99999999")).toBeNull();
  });
});

describe("cross-site mutations", () => {
  const fader = (headers: Record<string, string>) =>
    put("/api/params/cp750.sys.fader", { value: 100 }, headers);

  test("a foreign Origin is refused with 403 ORIGIN_NOT_ALLOWED", async () => {
    const { app, session } = await setup();
    for (const origin of ["https://evil.example", "null", "http://localhost:5173"]) {
      const res = await app.request(fader({ origin }));
      expect(res.status).toBe(403);
      expect(await json(res)).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    }
    const action = await app.request(
      post("/api/actions/cp750.ctrl.fader_delta", undefined, { origin: "https://evil.example" }),
    );
    expect(action.status).toBe(403);
    expect(writes(session.sent)).toEqual([]);
  });

  test("Sec-Fetch-Site: cross-site is refused even without an Origin", async () => {
    const { app } = await setup();
    const res = await app.request(fader({ "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("ORIGIN_NOT_ALLOWED");
  });

  test("same-origin, no Origin (curl) and CORS-listed origins pass", async () => {
    const { app } = await setup({ env: { CP750_CORS_ORIGIN: "http://booth.local:5173" } });
    expect((await app.request(fader({ origin: "http://localhost" }))).status).toBe(200);
    expect(
      (await app.request(fader({ origin: "http://localhost", "sec-fetch-site": "same-origin" })))
        .status,
    ).toBe(200);
    expect((await app.request(fader({}))).status).toBe(200);
    expect(
      (
        await app.request(
          fader({ origin: "http://booth.local:5173", "sec-fetch-site": "cross-site" }),
        )
      ).status,
    ).toBe(200);
    expect((await app.request(fader({ origin: "http://other.local:5173" }))).status).toBe(403);
  });

  test("reads are not origin-checked (CORS decides whether a page may see them)", async () => {
    const { app } = await setup();
    const res = await app.request("/api/device", {
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("mutation bodies", () => {
  test("a body-less action without a JSON content type is 415 and never reaches the device", async () => {
    const { app, session } = await setup();
    // What a cross-site <form method=post> or fetch(..., {mode: "no-cors"}) sends.
    for (const headers of [
      {} as Record<string, string>,
      { "content-type": "text/plain" },
      { "content-type": "multipart/form-data; boundary=x" },
    ]) {
      const res = await app.request(
        new Request("http://localhost/api/actions/cp750.ctrl.fader_delta", {
          method: "POST",
          headers,
        }),
      );
      expect(res.status).toBe(415);
      expect(await json(res)).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
    }
    const form = await app.request(
      new Request("http://localhost/api/params/cp750.sys.fader", {
        method: "PUT",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "value=100",
      }),
    );
    expect(form.status).toBe(415);
    expect(writes(session.sent)).toEqual([]);
  });

  test("an empty JSON action body counts as {}", async () => {
    const { app, session } = await setup();
    const res = await app.request(
      post("/api/actions/cp750.ctrl.fader_delta", undefined, {
        "content-type": "Application/JSON; charset=utf-8",
      }),
    );
    expect(res.status).toBe(200);
    expect(session.sent).toContain("cp750.ctrl.fader_delta 1");
  });

  test("an empty PUT body is still a 400", async () => {
    const { app } = await setup();
    const res = await app.request(
      new Request("http://localhost/api/params/cp750.sys.fader", {
        method: "PUT",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test(`bodies over ${MAX_BODY_BYTES} bytes are 413`, async () => {
    const { app } = await setup();
    const res = await app.request(
      put("/api/params/cp750.sys.hostname", { value: "x".repeat(MAX_BODY_BYTES) }),
    );
    expect(res.status).toBe(413);
    expect((await json(res)).code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("string values are limited to 256 characters", async () => {
    const { app } = await setup();
    const res = await app.request(
      put("/api/params/cp750.sys.hostname", { value: "x".repeat(257) }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("BAD_REQUEST");
  });

  test("an over-long name on a read is a 400", async () => {
    const { app } = await setup();
    const res = await app.request(`/api/params/${"x".repeat(200)}`);
    expect(res.status).toBe(400);
  });
});

describe("access before confirmation", () => {
  test("PUT on a destructive action says access, not confirmation-required", async () => {
    const { app, session } = await setup();
    const res = await app.request(put("/api/params/cp750.ctrl.reboot", { value: 1 }));
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ reason: "access", param: "cp750.ctrl.reboot" });
    expect(writes(session.sent)).toEqual([]);
  });
});

describe("GET /api/events limits", () => {
  function countSubscriptions(session: { subscribe: (l: never) => () => void }) {
    const state = { active: 0 };
    const subscribe = session.subscribe.bind(session);
    session.subscribe = (listener: never) => {
      state.active++;
      const unsubscribe = subscribe(listener);
      return () => {
        state.active--;
        unsubscribe();
      };
    };
    return state;
  }

  test("HEAD answers the headers without subscribing", async () => {
    const { app, session } = await setup();
    const subs = countSubscriptions(session);
    for (let i = 0; i < 50; i++) {
      const res = await app.request("/api/events", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toStartWith("text/event-stream");
    }
    expect(subs.active).toBe(0);
  });

  test("caps concurrent streams with 503 TOO_MANY_STREAMS", async () => {
    const { app, session } = await setup({ env: { CP750_MAX_SSE_CLIENTS: "2" } });
    const subs = countSubscriptions(session);
    const a = await app.request("/api/events");
    const b = await app.request("/api/events");
    expect([a.status, b.status]).toEqual([200, 200]);
    const c = await app.request("/api/events");
    expect(c.status).toBe(503);
    expect(await json(c)).toMatchObject({ code: "TOO_MANY_STREAMS" });
    expect(subs.active).toBe(2);

    await a.body?.cancel();
    for (let i = 0; i < 100 && subs.active > 1; i++) await Bun.sleep(5);
    expect(subs.active).toBe(1);
    const d = await app.request("/api/events");
    expect(d.status).toBe(200);
    await b.body?.cancel();
    await d.body?.cancel();
  });

  test("drops a client that stops reading once its backlog passes the cap", async () => {
    const { app, session, logs } = await setup({ app: { maxPendingEvents: 5 } });
    const subs = countSubscriptions(session);
    const res = await app.request("/api/events");
    expect(res.status).toBe(200);
    // Never read the body: every event stays queued.
    for (let i = 0; i < 20 && subs.active > 0; i++) {
      session.setDeviceValue("cp750.sys.fader", i);
      await Bun.sleep(1);
    }
    for (let i = 0; i < 100 && subs.active > 0; i++) await Bun.sleep(5);
    expect(subs.active).toBe(0);
    expect(logs.join("\n")).toContain("events: dropped a client");
    // The slot is free again.
    const again = await app.request("/api/events");
    expect(again.status).toBe(200);
    await again.body?.cancel();
  });
});

describe("request log", () => {
  test("logs the raw path, so encoded newlines cannot forge lines", async () => {
    const { app, logs } = await setup();
    await app.request("/api/params/x%0AGET%20%2Fapi%2Fhealth%20200%201.0ms");
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain("\n");
    expect(logs[0]).toStartWith("GET /api/params/x%0AGET%20%2Fapi%2Fhealth%20200%201.0ms 404");
  });

  test("escapeControl", () => {
    expect(escapeControl("a\nb\r\u001b[31mc ")).toBe("a\\x0ab\\x0d\\x1b[31mc\\u2028");
  });
});
