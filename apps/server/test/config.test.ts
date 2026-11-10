import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  configWarnings,
  isLoopback,
  isWildcardAddress,
  loadConfig,
  normalizeHostname,
} from "../src/config.ts";

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
      pollMs: 1000,
      manifestDir: undefined,
      mock: false,
      corsOrigins: [],
      allowedHosts: [],
      maxSseClients: 32,
    });
  });

  test("reads the environment", () => {
    const config = loadConfig({
      CP750_HOST: "10.0.0.5",
      CP750_PORT: "61409",
      CP750_LISTEN_HOST: "0.0.0.0",
      CP750_LISTEN_PORT: "8080",
      CP750_READ_ONLY: "true",
      CP750_ALLOW_FULL: "1",
      CP750_ALLOW_INTERNAL: "yes",
      CP750_API_TOKEN: "0123456789abcdef",
      CP750_EOL: "lf",
      CP750_POLL_MS: "1000",
      CP750_MANIFEST_DIR: "/etc/cp750",
      CP750_MOCK: "on",
      CP750_CORS_ORIGIN: "http://a.local:5173, https://b.example",
      CP750_ALLOWED_HOSTS: "Booth-PC.local, 192.168.1.20,[fe80::1]",
      CP750_MAX_SSE_CLIENTS: "4",
    });
    expect(config).toEqual({
      cp750Host: "10.0.0.5",
      cp750Port: 61409,
      listenHost: "0.0.0.0",
      port: 8080,
      readOnly: true,
      allowFull: true,
      allowInternal: true,
      apiToken: "0123456789abcdef",
      eol: "\n",
      pollMs: 1000,
      manifestDir: "/etc/cp750",
      mock: true,
      corsOrigins: ["http://a.local:5173", "https://b.example"],
      allowedHosts: ["booth-pc.local", "192.168.1.20", "[fe80::1]"],
      maxSseClients: 4,
    });
  });

  test("the generic names of older builds are not read", () => {
    const config = loadConfig({ PORT: "8080", LISTEN_HOST: "0.0.0.0", CORS_ORIGIN: "*" });
    expect(config).toMatchObject({ port: 2222, listenHost: "127.0.0.1", corsOrigins: [] });
  });

  test("CP750_POLL_MS defaults to 1000 and 0 turns polling off", () => {
    expect(loadConfig({}).pollMs).toBe(1000);
    expect(loadConfig({ CP750_POLL_MS: "0" }).pollMs).toBe(0);
    expect(loadConfig({}, ["--poll-ms", "250"]).pollMs).toBe(250);
  });

  test("flags override the environment", () => {
    const config = loadConfig(
      { CP750_LISTEN_PORT: "8080", CP750_HOST: "10.0.0.5", CP750_MOCK: "0" },
      ["serve", "--port", "9090", "--host", "10.0.0.9", "--mock", "--eol=cr", "--out", "ignored"],
    );
    expect(config).toMatchObject({ port: 9090, cp750Host: "10.0.0.9", mock: true, eol: "\r" });
    expect(loadConfig({}, ["--cp750-host", "a.local", "--host", "b.local"]).cp750Host).toBe(
      "a.local",
    );
  });

  test("empty values fall back to defaults; booleans accept 0/false/off", () => {
    expect(
      loadConfig({ CP750_LISTEN_PORT: "", CP750_API_TOKEN: "", CP750_READ_ONLY: "off" }),
    ).toMatchObject({
      port: 2222,
      apiToken: undefined,
      readOnly: false,
    });
    expect(loadConfig({ CP750_EOL: "\\r\\n" }).eol).toBe("\r\n");
  });

  test("reports every invalid setting with its variable and flag", () => {
    const found = issues(() =>
      loadConfig({
        CP750_LISTEN_PORT: "70000",
        CP750_PORT: "0",
        CP750_READ_ONLY: "maybe",
        CP750_EOL: "tab",
        CP750_POLL_MS: "-5",
        CP750_CORS_ORIGIN: "not a url",
        CP750_HOST: "bad host!",
        CP750_ALLOWED_HOSTS: "http://booth.local",
        CP750_MAX_SSE_CLIENTS: "0",
      }),
    );
    expect(found).toHaveLength(9);
    expect(found).toContain(
      'CP750_LISTEN_PORT / --port: expected an integer from 0 to 65535 (got "70000")',
    );
    expect(found.join("\n")).toContain("CP750_READ_ONLY / --read-only");
    expect(found.join("\n")).toContain("CP750_CORS_ORIGIN / --cors-origin");
    expect(found.join("\n")).toContain("CP750_ALLOWED_HOSTS / --allowed-hosts");
    expect(found.join("\n")).toContain("CP750_MAX_SSE_CLIENTS / --max-sse-clients");
    expect(found.join("\n")).toContain("CP750_HOST / --cp750-host");
  });

  test("never echoes the token in errors", () => {
    const found = issues(() => loadConfig({ CP750_API_TOKEN: "has space secret" }));
    expect(found).toEqual(["CP750_API_TOKEN: expected a token without whitespace"]);
  });

  test("the token must be at least 16 characters", () => {
    const found = issues(() => loadConfig({ CP750_API_TOKEN: "s3cr" }));
    expect(found).toHaveLength(1);
    expect(found[0]).toStartWith("CP750_API_TOKEN: too short: use at least 16 characters");
    expect(found[0]).not.toContain("s3cr");
    expect(loadConfig({ CP750_API_TOKEN: "a".repeat(16) }).apiToken).toBe("a".repeat(16));
  });

  test("ConfigError message lists the issues", () => {
    expect(() => loadConfig({}, ["--port", "x"])).toThrow(
      /Invalid configuration:\n {2}- CP750_LISTEN_PORT/,
    );
  });

  test("isLoopback parses addresses instead of matching prefixes", () => {
    for (const host of ["127.0.0.1", "127.255.0.9", "localhost", "LOCALHOST.", "::1", "[::1]"]) {
      expect(isLoopback(host)).toBe(true);
    }
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("0:0:0:0:0:0:0:1")).toBe(true);
    for (const host of [
      "0.0.0.0",
      "::",
      "192.168.1.10",
      "127.evil.example",
      "127.0.0.1.nip.io",
      "1270.0.0.1",
      "::2",
      "localhost.evil.example",
      "",
    ]) {
      expect(isLoopback(host)).toBe(false);
    }
  });

  test("normalizeHostname and isWildcardAddress", () => {
    expect(normalizeHostname("Booth.Local.")).toBe("booth.local");
    expect(normalizeHostname("::1")).toBe("[::1]");
    expect(normalizeHostname("[0:0::1]")).toBe("[::1]");
    expect(normalizeHostname("[127.0.0.1]")).toBeNull();
    expect(normalizeHostname("http://x")).toBeNull();
    expect(normalizeHostname("a b")).toBeNull();
    expect(normalizeHostname("999.1.1.1")).toBeNull();
    expect(isWildcardAddress("0.0.0.0")).toBe(true);
    expect(isWildcardAddress("::")).toBe(true);
    expect(isWildcardAddress("127.0.0.1")).toBe(false);
  });
});

describe("configWarnings", () => {
  test("names unknown CP750_* variables, with a suggestion for typos", () => {
    const env = { CP750_READONLY: "1", CP750_FROB: "x", PORT: "80", CP750_HOST: "a" };
    expect(configWarnings(env, loadConfig(env))).toEqual([
      "unknown environment variable CP750_FROB is ignored",
      "unknown environment variable CP750_READONLY is ignored (did you mean CP750_READ_ONLY?)",
    ]);
  });

  test("warns about wildcard CORS without a token", () => {
    const open = { CP750_CORS_ORIGIN: "*" };
    expect(configWarnings(open, loadConfig(open))).toEqual([
      expect.stringContaining("CP750_CORS_ORIGIN=* without CP750_API_TOKEN"),
    ]);
    const tokened = { ...open, CP750_API_TOKEN: "0123456789abcdef" };
    expect(configWarnings(tokened, loadConfig(tokened))).toEqual([]);
  });
});
