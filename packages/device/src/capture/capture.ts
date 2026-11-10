/**
 * `cp750 capture`: records what a unit says about itself and turns it into a draft manifest
 * (docs/ARCHITECTURE.md, "CLI and distribution").
 */
import {
  assertManifest,
  builtinManifests,
  type Manifest,
  type ManifestMatch,
  type ParamSpec,
  type ParamTier,
  selectManifest,
} from "@cp750/manifests";
import { DEFAULT_PORT } from "../contracts.ts";
import { UnknownParameter } from "../errors.ts";
import { Cp750Client } from "../protocol/client.ts";
import { extractCommands, extractFirmware, extractParamNames } from "../protocol/help.ts";

const FULL_CONTROL = "cp750.ctrl.full_ascii_ctrl";
const VERSION = "cp750.sysinfo.version";
const ALWAYS_COMMANDS = ["help", "status", "dump_log", "dump_log_100", "exit"] as const;

export interface CaptureOptions {
  host: string;
  /** Default 61408. */
  port?: number;
  /** Default `\r\n`. */
  eol?: string;
  /** Connect and per-command timeout. Default 5000. */
  timeoutMs?: number;
  /** Multi-line replies end after this much silence. Default 500. */
  idleMs?: number;
  /** Manifests to merge specs from. Default: the built-ins. */
  manifests?: readonly Manifest[];
}

export interface CaptureResult {
  /** Firmware from `cp750.sysinfo.version`. */
  firmware: string;
  /** The raw version reply line. */
  versionLine: string;
  /** `help` output (NULs stripped), with the normal command set. */
  help: string[];
  /** `status` output, with the normal command set. */
  status: string[];
  /** `help` with `full_ascii_ctrl` 1, or `null` if the unit refused full control. */
  helpFull: string[] | null;
  /** `status` with `full_ascii_ctrl` 1, or `null` if the unit refused full control. */
  statusFull: string[] | null;
  /** The manifest specs were merged from. */
  base: { firmware: string; match: ManifestMatch } | null;
  /** A `status: "draft"` manifest that passes `assertManifest`. */
  draftManifest: Manifest;
}

/**
 * Connects, reads the version, `help` and `status` (first with the normal set, then with the full
 * set enabled, which is turned off again afterwards), sends `exit`, and builds a draft manifest.
 */
export async function captureDevice(options: CaptureOptions): Promise<CaptureResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const port = options.port ?? DEFAULT_PORT;
  const client = await Cp750Client.connect({
    host: options.host,
    port,
    ...(options.eol !== undefined && { eol: options.eol }),
    connectTimeoutMs: timeoutMs,
    commandTimeoutMs: timeoutMs,
    idleMs: options.idleMs ?? 500,
  });
  try {
    const version = await client.query(VERSION);
    const firmware = extractFirmware(version.value);
    if (!firmware)
      throw new Error(`Unrecognized firmware version: ${JSON.stringify(version.line)}`);
    const help = await client.multi("help");
    const status = await client.multi("status");

    let helpFull: string[] | null = null;
    let statusFull: string[] | null = null;
    try {
      const enabled = await client.set(FULL_CONTROL, "1");
      if (enabled.value.trim() === "1") {
        helpFull = await client.multi("help");
        statusFull = await client.multi("status");
        await client.set(FULL_CONTROL, "0");
      }
    } catch (error) {
      if (!(error instanceof UnknownParameter)) throw error;
    }

    const draft = buildDraftManifest({
      firmware,
      help,
      status,
      helpFull,
      statusFull,
      manifests: options.manifests ?? builtinManifests(),
      ref: `cp750 capture of ${options.host}:${port} on ${new Date().toISOString()}`,
    });
    return {
      firmware,
      versionLine: version.line,
      help,
      status,
      helpFull,
      statusFull,
      base: draft.base,
      draftManifest: draft.manifest,
    };
  } finally {
    await client.close();
  }
}

export interface DraftInput {
  firmware: string;
  help: readonly string[];
  status: readonly string[];
  helpFull: readonly string[] | null;
  statusFull: readonly string[] | null;
  manifests: readonly Manifest[];
  /** `sources[0].ref`. */
  ref: string;
}

/**
 * Builds a draft manifest from captured text:
 * - every `cp750.*` name in `help`/`status` becomes a param (plus `cp750.sysinfo.version`);
 * - names in the nearest manifest (exact or nearest lower firmware, else the oldest) take its spec;
 * - other names get `{"type":"string"}`, `readonly`, `accessSource: "observed"`;
 * - tier: when the full-set capture revealed names the normal one did not, a name seen with the
 *   normal set is `normal` and the rest `full` (this overrides the base spec). Otherwise the
 *   capture cannot tell tiers apart: the base spec's tier is kept, and unknown names are `normal`.
 */
export function buildDraftManifest(input: DraftInput): {
  manifest: Manifest;
  base: { firmware: string; match: ManifestMatch } | null;
} {
  const selection = selectManifest(input.firmware, input.manifests);
  const baseManifest = selection.manifest ?? input.manifests[0] ?? null;
  const base = baseManifest
    ? { firmware: baseManifest.firmware, match: selection.manifest ? selection.match : "none" }
    : null;

  const normalSeen = new Set(extractParamNames([...input.help, ...input.status]));
  const fullSeen = new Set(
    extractParamNames([...(input.helpFull ?? []), ...(input.statusFull ?? [])]),
  );
  const tiersObserved = [...fullSeen].some((name) => !normalSeen.has(name));
  const names = [...new Set([VERSION, ...normalSeen, ...fullSeen])].sort();

  const params: Record<string, ParamSpec> = {};
  let unknown = 0;
  for (const name of names) {
    const known = baseManifest?.params[name];
    const observedTier: ParamTier = normalSeen.has(name) || name === VERSION ? "normal" : "full";
    if (known) {
      params[name] = { ...known, tier: tiersObserved ? observedTier : known.tier };
      continue;
    }
    unknown++;
    params[name] = {
      tier: tiersObserved ? observedTier : "normal",
      access: "readonly",
      accessSource: "observed",
      value: { type: "string" },
      ...(name.startsWith("cp750.internal.") && { internal: true }),
      description: "Seen in a capture; not in the built-in manifest",
    };
  }

  const words = new Set(extractCommands([...input.help, ...(input.helpFull ?? [])]));
  if (input.help.length > 0) words.add("help");
  if (input.status.length > 0) words.add("status");
  words.add("exit");
  const commands = ALWAYS_COMMANDS.filter((c) => words.has(c));

  const notes = base
    ? `Specs merged from the built-in ${base.firmware} manifest (${base.match}); ${unknown} name(s) not in it. Tiers ${tiersObserved ? "observed" : "copied from the base manifest"}.`
    : `No built-in manifest to merge from; ${unknown} name(s) typed as strings.`;
  const manifest: Manifest = {
    $schema: "../schema/cp750-manifest.v1.schema.json",
    manifestVersion: 1,
    firmware: input.firmware,
    status: "draft",
    sources: [{ kind: "capture", ref: input.ref, notes }],
    params,
    commands,
  };
  return { manifest: assertManifest(manifest, `capture draft ${input.firmware}`), base };
}
