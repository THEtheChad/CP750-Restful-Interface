import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifestDir } from "@cp750/manifests";
import { SERVER_VERSION } from "../src/app.ts";
import { writeCapture } from "../src/capture.ts";
import { type CliIo, main } from "../src/cli.ts";
import { draft } from "./helpers.ts";

function io(shutdown?: Promise<string>) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIo = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...(shutdown ? { shutdownSignal: () => shutdown } : {}),
  };
  return { out, err, io: value };
}

describe("cli", () => {
  test("--version and --help", async () => {
    const v = io();
    expect(await main(["--version"], {}, v.io)).toBe(0);
    expect(v.out).toEqual([SERVER_VERSION]);
    const h = io();
    expect(await main(["--help"], {}, h.io)).toBe(0);
    expect(h.out[0]).toContain("cp750 serve [--mock]");
    expect(h.out[0]).toContain("CP750_API_TOKEN");
  });

  test("usage errors exit 2", async () => {
    for (const argv of [[], ["frobnicate"], ["serve", "--bogus"], ["query"], ["serve", "extra"]]) {
      const r = io();
      expect(await main(argv, {}, r.io)).toBe(2);
    }
    const r = io();
    expect(await main(["serve", "--mock"], { CP750_LISTEN_PORT: "nope" }, r.io)).toBe(2);
    expect(r.err[0]).toContain("CP750_LISTEN_PORT / --port");
  });

  test("query --mock prints the reading as JSON", async () => {
    const r = io();
    expect(await main(["query", "cp750.sys.fader", "--mock"], {}, r.io)).toBe(0);
    expect(JSON.parse(r.out[0] as string)).toEqual({
      name: "cp750.sys.fader",
      value: 70,
      raw: "70",
      unit: "fader",
      db: 0,
    });
    const unknown = io();
    expect(await main(["query", "cp750.sys.nope"], { CP750_MOCK: "1" }, unknown.io)).toBe(1);
    expect(unknown.err[0]).toContain("not a known parameter");
  });

  test("real-device modes fail cleanly when the CP750 is unreachable", async () => {
    // Grab a free port, then close it so nothing is listening there.
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = String(probe.port);
    probe.stop(true);
    const env = { CP750_HOST: "127.0.0.1", CP750_PORT: port };
    const query = io();
    expect(await main(["query", "version"], env, query.io)).toBe(1);
    expect(query.err.join("\n")).not.toBe("");
    const capture = io();
    expect(
      await main(["capture", "--host", "127.0.0.1", "--cp750-port", port], {}, capture.io),
    ).toBe(1);
    expect(capture.err.join("\n")).not.toBe("");
  });

  test("serve --mock answers HTTP and shuts down on a signal", async () => {
    let stop: (signal: string) => void = () => {};
    const shutdown = new Promise<string>((resolve) => {
      stop = resolve;
    });
    const r = io(shutdown);
    const running = main(["serve", "--mock", "--port", "0"], {}, r.io);
    let url: string | undefined;
    for (let i = 0; i < 100 && !url; i++) {
      url = /listening on (\S+)/.exec(r.out.join("\n"))?.[1];
      if (!url) await Bun.sleep(10);
    }
    expect(url).toBeDefined();
    let device: { connection?: string } = {};
    for (let i = 0; i < 100 && device.connection !== "connected"; i++) {
      device = (await (await fetch(new URL("/api/device", url))).json()) as { connection?: string };
      if (device.connection !== "connected") await Bun.sleep(20);
    }
    expect(device).toMatchObject({ connection: "connected", firmware: "1.2.8.3" });
    const write = await fetch(new URL("/api/params/cp750.sys.fader", url), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 65 }),
    });
    expect(write.status).toBe(200);

    stop("SIGTERM");
    expect(await running).toBe(0);
    expect(r.out.join("\n")).toContain("SIGTERM: shutting down");
    expect(r.out.join("\n")).toContain("connection: closed");
    expect(fetch(new URL("/api/health", url))).rejects.toThrow();
  });

  test("warns about unknown CP750_* variables", async () => {
    const r = io(Promise.resolve("SIGINT"));
    expect(await main(["serve", "--mock", "--port", "0"], { CP750_READONLY: "1" }, r.io)).toBe(0);
    expect(r.err.join("\n")).toContain(
      "WARNING: unknown environment variable CP750_READONLY is ignored (did you mean CP750_READ_ONLY?)",
    );
  });

  test("serve enforces Host, content type and body size over real HTTP", async () => {
    let stop: (signal: string) => void = () => {};
    const shutdown = new Promise<string>((resolve) => {
      stop = resolve;
    });
    const r = io(shutdown);
    const running = main(["serve", "--mock", "--port", "0"], {}, r.io);
    let url: string | undefined;
    for (let i = 0; i < 100 && !url; i++) {
      url = /listening on (\S+)/.exec(r.out.join("\n"))?.[1];
      if (!url) await Bun.sleep(10);
    }
    try {
      const health = new URL("/api/health", url);
      expect((await fetch(health)).status).toBe(200);
      const rebound = await fetch(health, { headers: { host: `evil.example:${health.port}` } });
      expect(rebound.status).toBe(421);
      const head = await fetch(new URL("/api/events", url), { method: "HEAD" });
      expect(head.status).toBe(200);
      const bare = await fetch(new URL("/api/actions/cp750.ctrl.fader_delta", url), {
        method: "POST",
      });
      expect(bare.status).toBe(415);
      const huge = await fetch(new URL("/api/params/cp750.sys.hostname", url), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(64 * 1024) }),
      });
      expect(huge.status).toBe(413);
    } finally {
      stop("SIGTERM");
      expect(await running).toBe(0);
    }
  });

  test("serve warns when exposed without a token", async () => {
    const r = io(Promise.resolve("SIGINT"));
    expect(
      await main(["serve", "--mock", "--port", "0", "--listen-host", "0.0.0.0"], {}, r.io),
    ).toBe(0);
    expect(r.err.join("\n")).toContain("WARNING");
  });
});

describe("writeCapture", () => {
  const capture = {
    firmware: "1.2.8.3",
    versionLine: "cp750.sysinfo.version 1.2.8.3",
    help: ["cp750.sys.fader", "cp750.sys.mute"],
    status: ["cp750.sys.fader : 70"],
    helpFull: ["cp750.sys.fader", "cp750.sys.mute", "cp750.sys.mute_fade_in_time"],
    statusFull: ["cp750.sys.fader : 70", "cp750.sys.mute_fade_in_time : 500"],
    draftManifest: draft,
  };

  test("writes the raw text under <firmware>/ and the manifest as <firmware>.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cp750-capture-"));
    try {
      const files = await writeCapture(dir, capture);
      expect(files.dir).toBe(join(dir, "1.2.8.3"));
      expect(await readFile(files.version, "utf8")).toBe("cp750.sysinfo.version 1.2.8.3\n");
      expect(await readFile(files.help, "utf8")).toBe("cp750.sys.fader\ncp750.sys.mute\n");
      expect(await readFile(files.status, "utf8")).toBe("cp750.sys.fader : 70\n");
      expect(await readFile(files.helpFull as string, "utf8")).toContain("mute_fade_in_time\n");
      expect(await readFile(files.statusFull as string, "utf8")).toContain("_time : 500\n");
      expect(files.manifest).toBe(join(dir, "1.2.8.3.json"));
      expect(JSON.parse(await readFile(files.manifest, "utf8"))).toEqual(draft);
      // The output directory loads as CP750_MANIFEST_DIR as-is.
      const loaded = await loadManifestDir(dir);
      expect(loaded.map((m) => m.firmware)).toEqual(["1.2.8.3"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("skips the full-set files when the unit refused full control", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cp750-capture-"));
    try {
      const files = await writeCapture(dir, { ...capture, helpFull: null, statusFull: null });
      expect(files.helpFull).toBeNull();
      expect(files.statusFull).toBeNull();
      expect((await readdir(files.dir)).sort()).toEqual(["help.txt", "status.txt", "version.txt"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses firmware strings that are not safe file names", async () => {
    await expect(writeCapture(tmpdir(), { ...capture, firmware: "../../etc" })).rejects.toThrow(
      /unexpected firmware/,
    );
  });
});
