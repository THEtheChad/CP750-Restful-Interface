import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Validator } from "@seriousme/openapi-schema-validator";
import { buildOpenApiDocument, openApiJson } from "../src/openapi.ts";
import { setup } from "./helpers.ts";

const root = join(import.meta.dir, "..", "..", "..");
const committed = join(root, "openapi", "cp750.openapi.json");
const script = join(root, "apps", "server", "scripts", "openapi.ts");

function runScript(args: string[]) {
  return Bun.spawnSync([process.execPath, script, ...args], { cwd: root, stderr: "pipe" });
}

describe("OpenAPI document", () => {
  test("is a valid OpenAPI 3.1 document", async () => {
    const validator = new Validator();
    const result = await validator.validate(buildOpenApiDocument());
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
    expect(validator.version).toBe("3.1");
  });

  test("covers every route with operationIds, tags and problem responses", () => {
    // biome-ignore lint/suspicious/noExplicitAny: walking a JSON document
    const doc = buildOpenApiDocument() as any;
    const ops = Object.entries(doc.paths).flatMap(([path, item]) =>
      // biome-ignore lint/suspicious/noExplicitAny: walking a JSON document
      Object.entries(item as Record<string, any>).map(([method, op]) => ({ path, method, op })),
    );
    expect(
      ops.map((o) => `${o.method.toUpperCase()} ${o.path} ${o.op.operationId}`).sort(),
    ).toEqual([
      "GET /api/commands listCommands",
      "GET /api/device getDevice",
      "GET /api/events streamEvents",
      "GET /api/health getHealth",
      "GET /api/openapi.json getOpenApi",
      "GET /api/params/{name} readParam",
      "POST /api/actions/{name} triggerAction",
      "PUT /api/params/{name} writeParam",
    ]);
    for (const { op } of ops) expect(op.tags.length).toBeGreaterThan(0);

    const write = doc.paths["/api/params/{name}"].put;
    expect(Object.keys(write.responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "403", "404", "422", "503", "504"]),
    );
    expect(write.responses["422"].content["application/problem+json"].schema.$ref).toBe(
      "#/components/schemas/Problem",
    );
    expect(write.security).toEqual([{ bearerAuth: [] }, {}]);
    const name = write.parameters.find((p: { name: string }) => p.name === "name");
    expect(name).toMatchObject({ in: "path", required: true, schema: { type: "string" } });
    expect(name.schema.enum).toBeUndefined();
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ scheme: "bearer" });
  });

  test("has stable key order", () => {
    const text = openApiJson();
    expect(text).toBe(openApiJson());
    expect(Object.keys(JSON.parse(text)).slice(0, 4)).toEqual(["openapi", "info", "tags", "paths"]);
  });

  test("the served document equals the committed one", async () => {
    const { app } = await setup();
    const served = await (await app.request("/api/openapi.json")).json();
    expect(served).toEqual(JSON.parse(await readFile(committed, "utf8")));
  });

  test("openapi:check passes on the committed file and fails on drift", async () => {
    const ok = runScript(["--check"]);
    expect(ok.exitCode).toBe(0);

    const dir = await mkdtemp(join(tmpdir(), "cp750-openapi-"));
    try {
      const stale = join(dir, "stale.json");
      await writeFile(stale, openApiJson().replace('"getHealth"', '"getHealthOld"'));
      const drift = runScript(["--check", "--file", stale]);
      expect(drift.exitCode).toBe(1);
      expect(drift.stderr.toString()).toContain("out of date");

      expect(runScript(["--file", stale]).exitCode).toBe(0);
      expect(await readFile(stale, "utf8")).toBe(openApiJson());
      expect(runScript(["--check", "--file", stale]).exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
