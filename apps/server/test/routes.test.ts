import { describe, expect, test } from "bun:test";
import { faderToDb } from "@cp750/manifests";
import { draft, json, post, put, setup, verified } from "./helpers.ts";

describe("routes", () => {
  test("GET /api/health", async () => {
    const { app } = await setup();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: expect.any(String) });
  });

  test("GET /api/device reports connection, firmware and manifest", async () => {
    const { app } = await setup({ fake: { manifest: draft } });
    const body = await json(await app.request("/api/device"));
    expect(body).toMatchObject({
      connection: "connected",
      host: "192.168.1.136",
      port: 61408,
      firmware: "1.2.8.3",
      manifest: { firmware: "1.2.8.3", status: "draft", match: "exact", verified: false },
      fullControl: false,
      readOnly: false,
      authRequired: false,
      lastError: null,
    });
  });

  test("GET /api/device before detection", async () => {
    const { app } = await setup({ connect: false });
    const body = await json(await app.request("/api/device"));
    expect(body).toMatchObject({ connection: "idle", firmware: null, manifest: null });
  });

  test("GET /api/commands returns each param with its JSON Schema", async () => {
    const { app } = await setup();
    const body = await json(await app.request("/api/commands"));
    expect(body.firmware).toBe(verified.firmware);
    expect(body.manifest).toMatchObject({ match: "exact", verified: true });
    const fader = body.commands.find((c: { name: string }) => c.name === "cp750.sys.fader");
    expect(fader).toEqual({
      name: "cp750.sys.fader",
      aliases: [],
      source: "manifest",
      availability: "unchecked",
      operations: ["read", "write"],
      blocked: {},
      access: "readwrite",
      tier: "normal",
      unit: "fader",
      destructive: false,
      internal: false,
      description: expect.any(String),
      schema: { type: "integer", minimum: 0, maximum: 100 },
    });
    const reboot = body.commands.find((c: { name: string }) => c.name === "cp750.ctrl.reboot");
    expect(reboot).toMatchObject({ destructive: true, operations: ["read", "action"] });
    expect(body.commands.some((c: { internal: boolean }) => c.internal)).toBe(false);
  });

  test("GET /api/params/{name} reads a value", async () => {
    const { app } = await setup({ fake: { values: { "cp750.sys.input_mode": "dig_1" } } });
    const body = await json(await app.request("/api/params/cp750.sys.input_mode"));
    expect(body).toEqual({ name: "cp750.sys.input_mode", value: "dig_1", raw: "dig_1" });
  });

  test("GET adds unit, and db for faders", async () => {
    const { app } = await setup({ fake: { values: { "cp750.sys.fader": 55 } } });
    const body = await json(await app.request("/api/params/cp750.sys.fader"));
    expect(body).toEqual({
      name: "cp750.sys.fader",
      value: 55,
      raw: "55",
      unit: "fader",
      db: faderToDb(55),
    });
    expect(body.db).toBe(-5);
    const delay = await json(await app.request("/api/params/cp750.sys.analog_global_delay"));
    expect(delay.unit).toBe("ms");
    expect(delay.db).toBeUndefined();
  });

  test("names accept aliases, case-insensitively", async () => {
    const { app } = await setup();
    for (const name of ["version", "VERSION", "Cp750.SysInfo.Version"]) {
      const res = await app.request(`/api/params/${name}`);
      expect(res.status).toBe(200);
      expect((await json(res)).name).toBe("cp750.sysinfo.version");
    }
    const res = await app.request(put("/api/params/CP750.SYS.FADER", { value: 70 }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ name: "cp750.sys.fader", value: 70, db: 0 });
  });

  test("PUT /api/params/{name} writes and returns the new value", async () => {
    const { app, session } = await setup();
    const res = await app.request(put("/api/params/cp750.sys.fader", { value: 40 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "cp750.sys.fader",
      value: 40,
      raw: "40",
      unit: "fader",
      db: -10,
    });
    expect(session.sent).toContain("cp750.sys.fader 40");
  });

  test("POST /api/actions/{name} with a value and with an empty JSON body", async () => {
    const { app, session } = await setup();
    const res = await app.request(post("/api/actions/cp750.ctrl.fader_delta", { value: -5 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "cp750.ctrl.fader_delta", value: -5, raw: "-5" });

    const bare = await app.request(post("/api/actions/cp750.ctrl.full_ascii_ctrl"));
    expect(bare.status).toBe(200);
    expect((await json(bare)).value).toBe(1);
    expect(session.sent).toContain("cp750.ctrl.full_ascii_ctrl 1");
  });

  test("GET /api/openapi.json serves the document", async () => {
    const { app } = await setup();
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = await json(res);
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/api/params/{name}");
  });

  test("unknown API routes are problem+json 404s", async () => {
    const { app } = await setup();
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await json(res)).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  test("a wrong method on a real route is a 405 with Allow", async () => {
    const { app } = await setup();
    const del = await app.request("/api/params/cp750.sys.fader", { method: "DELETE" });
    expect(del.status).toBe(405);
    expect(del.headers.get("allow")).toBe("GET, HEAD, PUT");
    expect(await json(del)).toMatchObject({ code: "METHOD_NOT_ALLOWED", status: 405 });
    const post = await app.request("/api/params/cp750.sys.fader", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(post.status).toBe(405);
    const getAction = await app.request("/api/actions/cp750.ctrl.reboot");
    expect(getAction.status).toBe(405);
    expect(getAction.headers.get("allow")).toBe("POST");
    const putHealth = await app.request("/api/health", { method: "PUT" });
    expect(putHealth.status).toBe(405);
  });

  test("sets security headers and no CORS by default", async () => {
    const { app } = await setup();
    const res = await app.request("/api/health", { headers: { origin: "https://evil.example" } });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("CP750_CORS_ORIGIN opts in to CORS for listed origins", async () => {
    const { app } = await setup({ env: { CP750_CORS_ORIGIN: "http://booth.local:5173" } });
    const ok = await app.request("/api/health", { headers: { origin: "http://booth.local:5173" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://booth.local:5173");
    const other = await app.request("/api/health", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await app.request("/api/params/cp750.sys.fader", {
      method: "OPTIONS",
      headers: {
        origin: "http://booth.local:5173",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PUT");
  });

  test("logs each request without query strings or headers", async () => {
    const { app, logs } = await setup();
    await app.request("/api/health?secret=1", { headers: { authorization: "Bearer abc" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^GET \/api\/health 200 \d+\.\dms$/);
  });
});
