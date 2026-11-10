/**
 * `bun run compile`: builds the web client (when `apps/web` exists), embeds it via
 * `src/generated/web-assets.ts`, and compiles `src/cli.ts` into one executable per target:
 * `dist/cp750-<target>[.exe]`. The generated module is restored afterwards so the committed
 * (empty) version stays clean.
 *
 *   bun run compile                         all targets
 *   bun run compile --target linux-x64      only some (repeatable)
 */
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_WEB_DIST, WEB_ASSETS_MODULE, writeWebAssetsModule } from "./web-assets.ts";

const TARGETS = ["linux-x64", "windows-x64", "darwin-arm64"] as const;
type Target = (typeof TARGETS)[number];

const root = join(import.meta.dir, "..", "..", "..");
const webDir = join(root, "apps", "web");
const entry = join(import.meta.dir, "..", "src", "cli.ts");
const bun = process.execPath;

const { values } = parseArgs({
  options: { target: { type: "string", multiple: true } },
  strict: true,
});
const targets = (values.target ?? [...TARGETS]) as Target[];
for (const t of targets) {
  if (!TARGETS.includes(t)) throw new Error(`Unknown target ${t}; expected ${TARGETS.join(", ")}`);
}

function run(cmd: string[], cwd = root): void {
  const shown = cmd.map((c, i) => (i === 0 ? "bun" : relative(root, c) || c));
  console.log(`$ ${shown.join(" ")}`);
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

if (await exists(join(webDir, "package.json"))) {
  run([bun, "run", "--cwd", webDir, "build"]);
} else {
  console.log("apps/web does not exist yet; compiling without a web client.");
}

const original = await readFile(WEB_ASSETS_MODULE, "utf8");
try {
  const count = await writeWebAssetsModule(DEFAULT_WEB_DIST);
  console.log(`Embedding ${count} web files.`);
  for (const target of targets) {
    const outfile = join(
      root,
      "dist",
      `cp750-${target}${target.startsWith("windows") ? ".exe" : ""}`,
    );
    await rm(outfile, { force: true });
    run([
      bun,
      "build",
      entry,
      "--compile",
      `--target=bun-${target}`,
      "--minify",
      "--no-compile-autoload-bunfig",
      "--outfile",
      outfile,
    ]);
  }
} finally {
  await writeFile(WEB_ASSETS_MODULE, original);
}
