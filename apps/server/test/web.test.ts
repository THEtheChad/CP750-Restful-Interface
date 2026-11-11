import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webAssetsModule } from "../scripts/web-assets.ts";
import type { WebAssets } from "../src/web.ts";
import { setup } from "./helpers.ts";

let dir: string;
let assets: WebAssets;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cp750-web-"));
  await mkdir(join(dir, "dist", "assets"), { recursive: true });
  await writeFile(join(dir, "dist", "index.html"), "<!doctype html><div id=root></div>");
  await writeFile(join(dir, "dist", "assets", "app-abc123.js"), "console.log(1);");
  await writeFile(join(dir, "dist", "favicon.svg"), "<svg/>");
  assets = {
    "/index.html": join(dir, "dist", "index.html"),
    "/assets/app-abc123.js": join(dir, "dist", "assets", "app-abc123.js"),
    "/favicon.svg": join(dir, "dist", "favicon.svg"),
  };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("web client", () => {
  test("serves embedded files with types and cache headers", async () => {
    const { app } = await setup({ app: { webAssets: assets } });
    const index = await app.request("/");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(index.headers.get("cache-control")).toBe("no-cache");
    expect(await index.text()).toContain("id=root");

    const js = await app.request("/assets/app-abc123.js");
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(await js.text()).toBe("console.log(1);");

    const svg = await app.request("/favicon.svg");
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("falls back to index.html for SPA routes, 404 for missing files", async () => {
    const { app } = await setup({ app: { webAssets: assets } });
    const route = await app.request("/settings/audio");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("id=root");
    expect((await app.request("/assets/missing.js")).status).toBe(404);
    // Lookups only hit the asset map, never the filesystem: traversal just gets the SPA.
    expect(await (await app.request("/../../etc/passwd")).text()).toContain("id=root");
  });

  test("never serves the SPA for /api paths", async () => {
    const { app } = await setup({ app: { webAssets: assets } });
    const res = await app.request("/api/unknown/route");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  test("shows a notice when no web build is embedded", async () => {
    const { app } = await setup();
    for (const path of ["/", "/some/route"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("does not include the web client");
    }
    expect((await app.request("/app.js")).status).toBe(404);
  });

  test("HEAD returns headers only", async () => {
    const { app } = await setup({ app: { webAssets: assets } });
    const res = await app.request("/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("web-assets module generator", () => {
  test("emits file imports keyed by URL path, and the module loads", async () => {
    const moduleFile = join(dir, "gen", "web-assets.ts");
    await mkdir(join(dir, "gen"), { recursive: true });
    await writeFile(join(dir, "web.ts"), "export type WebAssets = Record<string, string>;\n");
    const source = await webAssetsModule(join(dir, "dist"), moduleFile);
    expect(source).toContain(
      'import asset0 from "../dist/assets/app-abc123.js" with { type: "file" };',
    );
    expect(source).toContain('"/index.html": asset2,');
    await writeFile(moduleFile, source);
    const { WEB_ASSETS } = (await import(moduleFile)) as { WEB_ASSETS: WebAssets };
    expect(Object.keys(WEB_ASSETS).sort()).toEqual([
      "/assets/app-abc123.js",
      "/favicon.svg",
      "/index.html",
    ]);
    expect(await Bun.file(WEB_ASSETS["/index.html"] as string).text()).toContain("id=root");
  });

  test("the committed module is the empty default", async () => {
    const committed = await readFile(
      join(import.meta.dir, "..", "src", "generated", "web-assets.ts"),
      "utf8",
    );
    expect(committed).toBe(await webAssetsModule(null));
  });
});
