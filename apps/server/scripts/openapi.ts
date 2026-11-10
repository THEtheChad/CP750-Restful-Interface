/**
 * Writes the OpenAPI 3.1 document to `openapi/cp750.openapi.json` (sorted keys, so diffs are
 * stable). `--check` fails instead if the committed file is stale. `--file <path>` targets another
 * file (tests).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { openApiJson } from "../src/openapi.ts";

export const OPENAPI_FILE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "openapi",
  "cp750.openapi.json",
);

const { values } = parseArgs({
  options: { check: { type: "boolean" }, file: { type: "string" } },
  strict: true,
});
const file = values.file ?? OPENAPI_FILE;
const shown = relative(process.cwd(), file);
const expected = openApiJson();

if (values.check) {
  const actual = await readFile(file, "utf8").catch(() => null);
  if (actual !== expected) {
    console.error(`${shown} is out of date. Run \`bun run openapi\` and commit the result.`);
    process.exit(1);
  }
  console.log(`${shown} is up to date.`);
} else {
  await writeFile(file, expected);
  console.log(`Wrote ${shown}.`);
}
