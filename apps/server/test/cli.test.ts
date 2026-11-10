import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(await main(["serve", "--mock"], { PORT: "nope" }, r.io)).toBe(2);
    expect(r.err[0]).toContain("PORT / --port");
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

  test("serve warns when exposed without a token", async () => {
    const r = io(Promise.resolve("SIGINT"));
    expect(
      await main(["serve", "--mock", "--port", "0", "--listen-host", "0.0.0.0"], {}, r.io),
    ).toBe(0);
    expect(r.err.join("\n")).toContain("WARNING");
  });
});

describe("writeCapture", () => {
  test("writes help.txt, status.txt and manifest.json under the firmware", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cp750-capture-"));
    try {
      const files = await writeCapture(dir, {
        firmware: "1.2.8.3",
        help: ["cp750.sys.fader", "cp750.sys.mute"],
        status: ["cp750.sys.fader : 70"],
        draftManifest: draft,
      });
      expect(files.dir).toBe(join(dir, "1.2.8.3"));
      expect(await readFile(files.help, "utf8")).toBe("cp750.sys.fader\ncp750.sys.mute\n");
      expect(await readFile(files.status, "utf8")).toBe("cp750.sys.fader : 70\n");
      expect(JSON.parse(await readFile(files.manifest, "utf8"))).toEqual(draft);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses firmware strings that are not safe directory names", async () => {
    await expect(
      writeCapture(tmpdir(), { firmware: "../../etc", help: [], status: [], draftManifest: draft }),
    ).rejects.toThrow(/unexpected firmware/);
  });
});
