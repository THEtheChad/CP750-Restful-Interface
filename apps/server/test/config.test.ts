import { describe, expect, test } from "bun:test";
import { ConfigError, isLoopback, loadConfig } from "../src/config.ts";

function issues(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("loadConfig", () => {
  test("defaults match docs/ARCHITECTURE.md", () => {
    expect(loadConfig({})).toEqual({
      cp750Host: "192.168.1.136",
      cp750Port: 61408,
      listenHost: "127.0.0.1",
      port: 2222,
      readOnly: false,
      allowFull: false,
      allowInternal: false,
      apiToken: undefined,
      eol: "\r\n",
      pollMs: undefined,
      manifestDir: undefined,
      mock: false,
      corsOrigins: [],
    });
  });

  test("reads the environment", () => {
    const config = loadConfig({
      CP750_HOST: "10.0.0.5",
      CP750_PORT: "61409",
      LISTEN_HOST: "0.0.0.0",
      PORT: "8080",
      CP750_READ_ONLY: "true",
      CP750_ALLOW_FULL: "1",
      CP750_ALLOW_INTERNAL: "yes",
      CP750_API_TOKEN: "tok",
      CP750_EOL: "lf",
      CP750_POLL_MS: "1000",
      CP750_MANIFEST_DIR: "/etc/cp750",
      CP750_MOCK: "on",
      CORS_ORIGIN: "http://a.local:5173, https://b.example",
    });
    expect(config).toEqual({
      cp750Host: "10.0.0.5",
      cp750Port: 61409,
      listenHost: "0.0.0.0",
      port: 8080,
      readOnly: true,
      allowFull: true,
      allowInternal: true,
      apiToken: "tok",
      eol: "\n",
      pollMs: 1000,
      manifestDir: "/etc/cp750",
      mock: true,
      corsOrigins: ["http://a.local:5173", "https://b.example"],
    });
  });

  test("flags override the environment", () => {
    const config = loadConfig({ PORT: "8080", CP750_HOST: "10.0.0.5", CP750_MOCK: "0" }, [
      "serve",
      "--port",
      "9090",
      "--host",
      "10.0.0.9",
      "--mock",
      "--eol=cr",
      "--out",
      "ignored",
    ]);
    expect(config).toMatchObject({ port: 9090, cp750Host: "10.0.0.9", mock: true, eol: "\r" });
    expect(loadConfig({}, ["--cp750-host", "a.local", "--host", "b.local"]).cp750Host).toBe(
      "a.local",
    );
  });

  test("empty values fall back to defaults; booleans accept 0/false/off", () => {
    expect(loadConfig({ PORT: "", CP750_API_TOKEN: "", CP750_READ_ONLY: "off" })).toMatchObject({
      port: 2222,
      apiToken: undefined,
      readOnly: false,
    });
    expect(loadConfig({ CP750_EOL: "\\r\\n" }).eol).toBe("\r\n");
  });

  test("reports every invalid setting with its variable and flag", () => {
    const found = issues(() =>
      loadConfig({
        PORT: "70000",
        CP750_PORT: "0",
        CP750_READ_ONLY: "maybe",
        CP750_EOL: "tab",
        CP750_POLL_MS: "-5",
        CORS_ORIGIN: "not a url",
        CP750_HOST: "bad host!",
      }),
    );
    expect(found).toHaveLength(7);
    expect(found).toContain('PORT / --port: expected an integer from 0 to 65535 (got "70000")');
    expect(found.join("\n")).toContain("CP750_READ_ONLY / --read-only");
    expect(found.join("\n")).toContain("CORS_ORIGIN / --cors-origin");
    expect(found.join("\n")).toContain("CP750_HOST / --cp750-host");
  });

  test("never echoes the token in errors", () => {
    const found = issues(() => loadConfig({ CP750_API_TOKEN: "has space secret" }));
    expect(found).toEqual(["CP750_API_TOKEN: expected a token without whitespace"]);
  });

  test("ConfigError message lists the issues", () => {
    expect(() => loadConfig({}, ["--port", "x"])).toThrow(/Invalid configuration:\n {2}- PORT/);
  });

  test("isLoopback", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("0.0.0.0")).toBe(false);
    expect(isLoopback("192.168.1.10")).toBe(false);
  });
});
