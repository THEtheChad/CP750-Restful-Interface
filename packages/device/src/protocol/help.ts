/**
 * Format-agnostic parsing of `help` and `status` output. The real reply formats are not documented,
 * so nothing here depends on layout: we only look for tokens.
 */

const PARAM_TOKEN = /cp750\.[a-z0-9_]+\.[a-z0-9_]+/gi;
const SINGLE_WORD_COMMANDS = ["help", "status", "dump_log", "dump_log_100", "exit"] as const;

/** Every distinct `cp750.x.y` token in `lines`, lowercased, in first-seen order. */
export function extractParamNames(lines: readonly string[]): string[] {
  const names = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(PARAM_TOKEN)) names.add(match[0].toLowerCase());
  }
  return [...names];
}

/** The known single-word commands that appear as whole words in `lines`. */
export function extractCommands(lines: readonly string[]): string[] {
  const words = new Set<string>();
  for (const line of lines) {
    for (const word of line.toLowerCase().split(/[^a-z0-9_.]+/)) words.add(word);
  }
  return SINGLE_WORD_COMMANDS.filter((c) => words.has(c));
}

/** The firmware version inside a `cp750.sysinfo.version` reply value, or `null`. */
export function extractFirmware(value: string): string | null {
  return /\d+(?:\.\d+)*/.exec(value)?.[0] ?? null;
}
