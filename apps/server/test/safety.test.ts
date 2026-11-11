import { describe, expect, test } from "bun:test";
import { tokensEqual } from "../src/app.ts";
import { json, post, put, setup } from "./helpers.ts";

const TOKEN = "s3cret-token-value";

describe("token auth", () => {
  test("mutations need the Bearer token when CP750_API_TOKEN is set", async () => {
    const { app, session } = await setup({ env: { CP750_API_TOKEN: TOKEN } });

    const missing = await app.request(put("/api/params/cp750.sys.fader", { value: 50 }));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("content-type")).toBe("application/problem+json");
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    expect((await json(missing)).code).toBe("UNAUTHORIZED");

    const wrong = await app.request(
      put("/api/params/cp750.sys.fader", { value: 50 }, { authorization: "Bearer nope" }),
    );
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toContain("invalid_token");

    const scheme = await app.request(
      put("/api/params/cp750.sys.fader", { value: 50 }, { authorization: `Basic ${TOKEN}` }),
    );
    expect(scheme.status).toBe(401);

    const action = await app.request(post("/api/actions/cp750.ctrl.fader_delta", { value: 1 }));
    expect(action.status).toBe(401);
    expect(session.sent.filter((l) => !l.endsWith("?"))).toEqual([]);

    const right = await app.request(
      put("/api/params/cp750.sys.fader", { value: 50 }, { authorization: `Bearer ${TOKEN}` }),
    );
    expect(right.status).toBe(200);
    const rightAction = await app.request(
      post(
        "/api/actions/cp750.ctrl.fader_delta",
        { value: 1 },
        { authorization: `bearer ${TOKEN}` },
      ),
    );
    expect(rightAction.status).toBe(200);
  });

  test("reads stay open", async () => {
    const { app } = await setup({ env: { CP750_API_TOKEN: TOKEN } });
    for (const path of ["/api/health", "/api/device", "/api/commands", "/api/params/version"]) {
      expect((await app.request(path)).status).toBe(200);
    }
    expect((await json(await app.request("/api/device"))).authRequired).toBe(true);
  });

  test("the token never reaches the log", async () => {
    const { app, logs } = await setup({ env: { CP750_API_TOKEN: TOKEN } });
    await app.request(
      put("/api/params/cp750.sys.fader", { value: 50 }, { authorization: `Bearer ${TOKEN}` }),
    );
    await app.request(
      put("/api/params/cp750.sys.fader", { value: 50 }, { authorization: "Bearer x" }),
    );
    expect(logs).toHaveLength(2);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });

  test("tokensEqual compares exactly, for any lengths", () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
    expect(tokensEqual(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokensEqual("", TOKEN)).toBe(false);
    expect(tokensEqual(TOKEN.toUpperCase(), TOKEN)).toBe(false);
  });
});

describe("read-only mode", () => {
  test("CP750_READ_ONLY refuses writes and actions with 403 read-only-mode", async () => {
    // The fake session itself is NOT read-only here: the HTTP layer refuses on its own.
    const { app, session } = await setup({ env: { CP750_READ_ONLY: "1" } });
    const write = await app.request(put("/api/params/cp750.sys.fader", { value: 50 }));
    expect(write.status).toBe(403);
    expect(await json(write)).toMatchObject({ code: "FORBIDDEN", reason: "read-only-mode" });
    const action = await app.request(post("/api/actions/cp750.ctrl.fader_delta", { value: 1 }));
    expect((await json(action)).reason).toBe("read-only-mode");
    expect(session.sent.filter((l) => !l.endsWith("?"))).toEqual([]);

    expect((await app.request("/api/params/cp750.sys.fader")).status).toBe(200);
    expect((await json(await app.request("/api/device"))).readOnly).toBe(true);
  });

  test("a read-only session is reported and enforced", async () => {
    const { app } = await setup({ fake: { readOnly: true } });
    const write = await app.request(put("/api/params/cp750.sys.fader", { value: 50 }));
    expect((await json(write)).reason).toBe("read-only-mode");
    expect((await json(await app.request("/api/device"))).readOnly).toBe(true);
  });
});

describe("destructive actions", () => {
  test("need confirm: true", async () => {
    const { app, session } = await setup();
    for (const body of [undefined, {}, { confirm: false }, { value: 1 }]) {
      const res = await app.request(post("/api/actions/cp750.ctrl.reboot", body));
      expect(res.status).toBe(403);
      expect(await json(res)).toMatchObject({
        code: "FORBIDDEN",
        reason: "confirmation-required",
        param: "cp750.ctrl.reboot",
      });
    }
    expect(session.sent).not.toContain("cp750.ctrl.reboot 1");

    const ok = await app.request(post("/api/actions/CP750.CTRL.REBOOT", { confirm: true }));
    expect(ok.status).toBe(200);
    expect(session.sent).toContain("cp750.ctrl.reboot 1");
  });

  test("the session enforces confirmation too", async () => {
    const { session } = await setup();
    await expect(session.action("cp750.ctrl.log_erase")).rejects.toMatchObject({
      reason: "confirmation-required",
    });
  });

  test("non-destructive actions do not need it", async () => {
    const { app } = await setup();
    const res = await app.request(post("/api/actions/cp750.ctrl.fader_delta", { value: 2 }));
    expect(res.status).toBe(200);
  });
});
