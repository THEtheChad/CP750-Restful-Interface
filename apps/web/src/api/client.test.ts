import { describe, expect, test } from "bun:test";
import { createFakeGateway, json } from "../../test/fake-gateway.ts";
import { createApi } from "./client.ts";
import { ApiError } from "./problem.ts";
import { createTokenStore } from "./token-store.ts";

const baseUrl = "http://localhost:2222";

describe("api client", () => {
  test("sends the Bearer token on mutations only", async () => {
    const gateway = createFakeGateway();
    const tokens = createTokenStore(null);
    tokens.set("s3cret");
    const api = createApi({ baseUrl, fetch: gateway.fetch, tokens });
    await api.readParam("cp750.sys.fader");
    await api.writeParam("cp750.sys.fader", 71);
    await api.triggerAction("cp750.ctrl.reboot", { confirm: true });
    expect(gateway.paramRequests().map((r) => [r.method, r.authorization])).toEqual([
      ["GET", null],
      ["PUT", "Bearer s3cret"],
      ["POST", "Bearer s3cret"],
    ]);
  });

  test("throws problem details as ApiError", async () => {
    const gateway = createFakeGateway();
    gateway.intercept(() =>
      json(
        {
          type: "urn:cp750:problem:forbidden",
          title: "Forbidden",
          status: 403,
          detail: "no",
          code: "FORBIDDEN",
          reason: "read-only-mode",
        },
        403,
      ),
    );
    const api = createApi({ baseUrl, fetch: gateway.fetch });
    const error = await api.writeParam("cp750.sys.fader", 71).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.problem.code).toBe("FORBIDDEN");
    expect(error.problem.reason).toBe("read-only-mode");
  });

  test("turns non-problem errors and network failures into problems too", async () => {
    const proxy = createApi({
      baseUrl,
      fetch: async () => new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }),
    });
    const bad = await proxy.getDevice().catch((e) => e);
    expect(bad.problem).toMatchObject({ code: "INTERNAL", status: 502, title: "Bad Gateway" });

    const offline = createApi({
      baseUrl,
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const down = await offline.getDevice().catch((e) => e);
    expect(down.problem).toMatchObject({ code: "NETWORK", status: 0 });
  });
});
