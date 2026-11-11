/** Search, namespace filter and grouping for the advanced parameter list. */
import type { Command, Operation } from "../../api/types.ts";
import {
  eqBandOf,
  eqChannelLabel,
  eqChannelRank,
  OTHER_GROUP,
  SYS_GROUP_RULES,
  sysGroupOf,
} from "../../lib/param-groups.ts";
import { namespaceOf } from "../../lib/schema-control.ts";

/** Namespaces in a sensible reading order; unknown ones follow alphabetically. */
export const NAMESPACE_ORDER = ["sys", "sys_tune", "state", "sysinfo", "ctrl", "internal"];

export const NAMESPACE_LABELS: Record<string, string> = {
  sys: "System",
  sys_tune: "Tuning",
  state: "State",
  sysinfo: "System info",
  ctrl: "Actions",
  internal: "Internal",
  other: "Other",
};

function rank(namespace: string): number {
  const i = NAMESPACE_ORDER.indexOf(namespace);
  return i === -1 ? NAMESPACE_ORDER.length : i;
}

function compareNamespaces(a: string, b: string): number {
  return rank(a) - rank(b) || a.localeCompare(b);
}

export const SCOPES = ["available", "locked", "all"] as const;
export type Scope = (typeof SCOPES)[number];

/** What the param is for: an action is triggered, a readwrite param written, the rest read. */
export function primaryOp(command: Command): Operation {
  return command.access === "action" ? "action" : command.access === "readwrite" ? "write" : "read";
}

/**
 * Locked: the gateway itself refuses the param's primary operation (full set, internal, not in the
 * unit's help…). Static per manifest and gateway flags; passing conditions such as the processor
 * being offline or a missing token never hide a row.
 */
export function isLocked(command: Command): boolean {
  return Boolean(command.blocked[primaryOp(command)]);
}

export function inScope(command: Command, scope: Scope): boolean {
  return scope === "all" || (scope === "locked") === isLocked(command);
}

/** Every search word must appear in the name, an alias or the description (case-insensitive). */
export function filterCommands(
  commands: Command[],
  query: string,
  namespace = "all",
  scope: Scope = "all",
): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((c) => {
    if (!inScope(c, scope)) return false;
    if (namespace !== "all" && namespaceOf(c.name) !== namespace) return false;
    if (words.length === 0) return true;
    const haystack = [c.name, ...c.aliases, c.description ?? ""].join(" ").toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

export interface CommandGroup {
  namespace: string;
  commands: Command[];
}

export function groupByNamespace(commands: Command[]): CommandGroup[] {
  const groups = new Map<string, Command[]>();
  for (const c of commands) {
    const ns = namespaceOf(c.name);
    const list = groups.get(ns);
    if (list) list.push(c);
    else groups.set(ns, [c]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareNamespaces(a, b))
    .map(([namespace, list]) => ({ namespace, commands: list }));
}

export function namespacesOf(commands: Command[]): { namespace: string; count: number }[] {
  return groupByNamespace(commands).map((g) => ({
    namespace: g.namespace,
    count: g.commands.length,
  }));
}

/** A section of the parameter list: a namespace, or for `sys` one of its groups. */
export interface DisplayGroup {
  key: string;
  label: string;
  /** The names it covers, as shown next to the label (`cp750.sys.eq_l_*`). */
  prefix: string;
  commands: Command[];
}

const SYS_ORDER = [...SYS_GROUP_RULES.map((r) => r.key), OTHER_GROUP.key];

/** `sys` split by `sysGroupOf`; the equalizer split per channel, bands low to high. */
function sysGroups(commands: Command[]): DisplayGroup[] {
  const byKey = new Map<string, { label: string; commands: Command[] }>();
  for (const c of commands) {
    const g = sysGroupOf(c.name) ?? OTHER_GROUP;
    const entry = byKey.get(g.key) ?? { label: g.label, commands: [] };
    entry.commands.push(c);
    byKey.set(g.key, entry);
  }
  const out: DisplayGroup[] = [];
  for (const key of SYS_ORDER) {
    const entry = byKey.get(key);
    if (!entry) continue;
    if (key !== "eq") {
      out.push({
        key: `sys:${key}`,
        label: entry.label,
        prefix: "cp750.sys.*",
        commands: entry.commands,
      });
      continue;
    }
    const channels = new Map<string, Command[]>();
    for (const c of entry.commands) {
      const channel = eqBandOf(c.name)?.channel ?? "";
      channels.set(channel, [...(channels.get(channel) ?? []), c]);
    }
    const hz = (c: Command) => eqBandOf(c.name)?.hz ?? -1;
    [...channels.entries()]
      .sort(([a], [b]) => eqChannelRank(a) - eqChannelRank(b) || a.localeCompare(b))
      .forEach(([channel, list]) => {
        out.push({
          key: `sys:eq:${channel}`,
          label: channel ? `Equalizer · ${eqChannelLabel(channel)}` : "Equalizer",
          prefix: channel ? `cp750.sys.eq_${channel}_*` : "cp750.sys.eq_*",
          commands: [...list].sort((a, b) => hz(a) - hz(b)),
        });
      });
  }
  return out;
}

/** The list's sections in reading order: `sys` by group, then the other namespaces. */
export function groupCommands(commands: Command[]): DisplayGroup[] {
  return groupByNamespace(commands).flatMap((g) =>
    g.namespace === "sys"
      ? sysGroups(g.commands)
      : [
          {
            key: g.namespace,
            label: NAMESPACE_LABELS[g.namespace] ?? g.namespace,
            prefix: `cp750.${g.namespace}.*`,
            commands: g.commands,
          },
        ],
  );
}
