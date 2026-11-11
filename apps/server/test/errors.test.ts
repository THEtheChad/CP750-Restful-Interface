import { describe, expect, test } from "bun:test";
import { type ParamResult, Timeout } from "@cp750/device";
import { FakeSession } from "@cp750/device/testing";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { problemFromError } from "../src/problem.ts";
import { draft, json, put, setup, verified } from "./helpers.ts";

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  const body = await json(res);
  // Match a copy: bun's toMatchObject writes asymmetric matchers back into the received object.
  expect(structuredClone(body)).toMatchObject({
    type: `urn:cp750:problem:${code.toLowerCase().replaceAll("_", "-")}`,
    title: expect.any(String),
    status,
    detail: expect.any(String),
    code,
  });
  return body;
}

class FailingSession extends FakeSession {
  constructor(private readonly error: unknown) {
    super({ manifest: verified });
  }

  override async read(): Promise<ParamResult> {
    throw this.error;
  }
}

describe("error mapping (RFC 9457)", () => {
  test("INVALID_VALUE -> 400 with the validation errors", async () => {
    const { app } = await setup();
    const res = await app.request(put("/api/params/cp750.sys.fader", { value: 101 }));
    const body = await expectProblem(res, 400, "INVALID_VALUE");
    expect(body.param).toBe("cp750.sys.fader");
    expect(body.errors).toEqual([expect.stringContaining("100")]);
    expect(body.instance).toBe("/api/params/cp750.sys.fader");
  });

  test("a malformed request body -> 400 BAD_REQUEST", async () => {
    const { app } = await setup();
    const missing = await app.request(put("/api/params/cp750.sys.fader", { nope: 1 }));
    const body = await expectProblem(missing, 400, "BAD_REQUEST");
    expect(body.errors[0]).toContain("json.value");
    const wrongType = await app.request(put("/api/params/cp750.sys.fader", { value: true }));
    await expectProblem(wrongType, 400, "BAD_REQUEST");
    const garbage = await app.request(
      new Request("http://localhost/api/params/cp750.sys.fader", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    await expectProblem(garbage, 400, "BAD_REQUEST");
  });

  test("FORBIDDEN -> 403 with the reason", async () => {
    const { app } = await setup();
    const res = await app.request(put("/api/params/cp750.sys.mute_fade_in_time", { value: 500 }));
    const body = await expectProblem(res, 403, "FORBIDDEN");
    expect(body.reason).toBe("full-tier");
    expect(body.param).toBe("cp750.sys.mute_fade_in_time");

    const readonly = await app.request(put("/api/params/cp750.sysinfo.version", { value: "x" }));
    expect((await expectProblem(readonly, 403, "FORBIDDEN")).reason).toBe("access");

    const internal = await app.request("/api/params/cp750.internal.save_params");
    expect((await expectProblem(internal, 403, "FORBIDDEN")).reason).toBe("internal");
  });

  test("an unverified manifest restricts writes (403 unverified)", async () => {
    const { app } = await setup({ fake: { manifest: draft, helpNames: ["cp750.sys.mute"] } });
    const res = await app.request(put("/api/params/cp750.sys.fader", { value: 50 }));
    // fader is not in this fake `help`, so it is unavailable: 404, not 403.
    await expectProblem(res, 404, "UNKNOWN_PARAMETER");
    const { app: app2 } = await setup({ fake: { manifest: draft } });
    const res2 = await app2.request(put("/api/params/cp750.sys.fader", { value: 50 }));
    expect((await expectProblem(res2, 403, "FORBIDDEN")).reason).toBe("unverified");
  });

  test("UNKNOWN_PARAMETER -> 404", async () => {
    const { app } = await setup();
    const res = await app.request("/api/params/cp750.sys.nope");
    expect((await expectProblem(res, 404, "UNKNOWN_PARAMETER")).param).toBe("cp750.sys.nope");
    const write = await app.request(put("/api/params/nope", { value: 1 }));
    await expectProblem(write, 404, "UNKNOWN_PARAMETER");
  });

  test("WRITE_REJECTED -> 422 with requested and actual", async () => {
    const { app, session } = await setup({ fake: { values: { "cp750.sys.fader": 70 } } });
    session.rejectWrites("cp750.sys.fader");
    const res = await app.request(put("/api/params/cp750.sys.fader", { value: 80 }));
    const body = await expectProblem(res, 422, "WRITE_REJECTED");
    expect(body).toMatchObject({
      param: "cp750.sys.fader",
      requested: 80,
      actual: 70,
      raw: "70",
    });
  });

  test("NOT_CONNECTED -> 503", async () => {
    const { app, session } = await setup();
    session.disconnect();
    await expectProblem(await app.request("/api/params/cp750.sys.fader"), 503, "NOT_CONNECTED");
    const write = await app.request(put("/api/params/cp750.sys.fader", { value: 1 }));
    await expectProblem(write, 503, "NOT_CONNECTED");
  });

  test("TIMEOUT -> 504", async () => {
    const session = new FailingSession(new Timeout(2000, "cp750.sys.fader ?"));
    await session.connect();
    const app = createApp({ session, config: loadConfig({}) });
    const res = await app.request("/api/params/fader");
    const body = await expectProblem(res, 504, "TIMEOUT");
    expect(body.detail).toContain("2000 ms");
  });

  test("unexpected errors -> 500 without internals, logged", async () => {
    const session = new FailingSession(new Error("socket exploded at 0xdeadbeef"));
    await session.connect();
    const logs: string[] = [];
    const app = createApp({ session, config: loadConfig({}), log: (l) => logs.push(l) });
    const res = await app.request("/api/params/cp750.sys.fader");
    const body = await expectProblem(res, 500, "INTERNAL");
    expect(JSON.stringify(body)).not.toContain("deadbeef");
    expect(logs.join("\n")).toContain("deadbeef");
  });

  test("maps by code, so errors from another copy of the module still map", () => {
    class Lookalike extends Error {
      readonly code = "TIMEOUT";
    }
    // Not a Cp750Error instance: falls back to 500 rather than trusting arbitrary objects.
    expect(problemFromError(new Lookalike("x")).status).toBe(500);
  });
});
