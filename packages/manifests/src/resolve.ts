import type { Manifest, ParamSpec } from "./types.ts";

const indexes = new WeakMap<Manifest, Map<string, string>>();

function indexOf(manifest: Manifest): Map<string, string> {
  let index = indexes.get(manifest);
  if (!index) {
    index = new Map();
    for (const [name, spec] of Object.entries(manifest.params)) {
      index.set(name.toLowerCase(), name);
      for (const alias of spec.aliases ?? []) index.set(alias.toLowerCase(), name);
    }
    indexes.set(manifest, index);
  }
  return index;
}

/** Trims and lowercases a param name, the way the unit treats it. */
export function normalizeParamName(input: string): string {
  return input.trim().toLowerCase();
}

/** Resolves a name or alias, case-insensitively, to the manifest's canonical param name. */
export function resolveParamName(manifest: Manifest, input: string): string | null {
  return indexOf(manifest).get(normalizeParamName(input)) ?? null;
}

export interface ResolvedParam {
  name: string;
  spec: ParamSpec;
}

/** Resolves a name or alias to the canonical name and its spec, or `null` if unknown. */
export function findParam(manifest: Manifest, input: string): ResolvedParam | null {
  const name = resolveParamName(manifest, input);
  const spec = name ? manifest.params[name] : undefined;
  return name && spec ? { name, spec } : null;
}
