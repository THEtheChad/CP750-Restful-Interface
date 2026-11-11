/** Search, namespace filter and grouping for the advanced parameter list. */
import type { Command } from "../../api/types.ts";
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

/** Every search word must appear in the name, an alias or the description (case-insensitive). */
export function filterCommands(commands: Command[], query: string, namespace = "all"): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((c) => {
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
