/**
 * The access rules from docs/ARCHITECTURE.md ("Session"), as pure functions so the real session
 * and `FakeSession` enforce exactly the same thing.
 */
import {
  findParam,
  type Manifest,
  normalizeParamName,
  type ParamSpec,
  validateValue,
} from "@cp750/manifests";
import type {
  Availability,
  CommandInfo,
  ForbiddenReasonOrUnknown,
  MutationOptions,
  ParamOperation,
} from "./contracts.ts";
import { Forbidden, InvalidValue, UnknownParameter } from "./errors.ts";

export interface AccessPolicy {
  /** The selected manifest, or `null` for `match: "none"` (raw passthrough reads only). */
  manifest: Manifest | null;
  verified: boolean;
  /** Names `help` listed (lowercase), or `null` when `help` yielded none (cross-check skipped). */
  helpNames: ReadonlySet<string> | null;
  allowFull: boolean;
  allowInternal: boolean;
  readOnly: boolean;
}

export interface ResolvedName {
  /** Canonical lowercase name. */
  name: string;
  /** `null` for names outside the manifest (help-only, or raw passthrough). */
  spec: ParamSpec | null;
  availability: Availability;
}

const OPERATIONS: readonly ParamOperation[] = ["read", "write", "action"];
const PARAM_NAME = /^cp750\.[a-z0-9_]+\.[a-z0-9_]+$/;
const RAW_COMMANDS = new Set(["help", "status", "dump_log", "dump_log_100"]);

function availabilityOf(policy: AccessPolicy, name: string): Availability {
  if (!policy.helpNames) return "unchecked";
  return policy.helpNames.has(name) ? "confirmed" : "missing";
}

/**
 * Resolves a caller-supplied name or alias. Returns `null` when the name is unknown: not in the
 * manifest, not listed by `help`, and (with no manifest) not even shaped like `cp750.x.y`.
 */
export function resolveName(policy: AccessPolicy, input: string): ResolvedName | null {
  const found = policy.manifest ? findParam(policy.manifest, input) : null;
  if (found) {
    return { name: found.name, spec: found.spec, availability: availabilityOf(policy, found.name) };
  }
  const name = normalizeParamName(input);
  if (policy.helpNames?.has(name)) return { name, spec: null, availability: "confirmed" };
  if (!policy.manifest && PARAM_NAME.test(name))
    return { name, spec: null, availability: "unchecked" };
  return null;
}

/**
 * Why `op` is not allowed on `target` right now, or `null` if it is. `confirm` is only checked
 * when `options` is given, so listings can ignore it.
 */
export function checkOperation(
  policy: AccessPolicy,
  target: ResolvedName,
  op: ParamOperation,
  options?: MutationOptions,
): ForbiddenReasonOrUnknown | null {
  const { spec, availability, name } = target;
  if (availability === "missing") return "unavailable";
  if (name.startsWith("cp750.internal.") && !policy.allowInternal) return "internal";
  if (!spec) return op === "read" ? null : "raw-only";
  if (spec.internal && !policy.allowInternal) return "internal";
  if (spec.tier === "full" && !policy.allowFull) return "full-tier";
  if (op === "read") return null;
  if (op === "write" && spec.access !== "readwrite") return "access";
  if (op === "action" && spec.access !== "action") return "access";
  if (policy.readOnly) return "read-only-mode";
  if (!policy.verified && availability !== "confirmed") return "unverified";
  if (options && spec.destructive && options.confirm !== true) return "confirmation-required";
  return null;
}

/** Resolves `input` and throws `UnknownParameter` or `Forbidden` unless `op` is allowed. */
export function assertOperation(
  policy: AccessPolicy,
  input: string,
  op: ParamOperation,
  options: MutationOptions = {},
): ResolvedName {
  const target = resolveName(policy, input);
  if (!target) throw new UnknownParameter(input);
  const reason = checkOperation(policy, target, op, options);
  if (reason === "unavailable") {
    throw new UnknownParameter(input, "is not available on this unit (missing from help)");
  }
  if (reason) throw new Forbidden(target.name, reason, `${op} ${target.name}: ${reason}`);
  return target;
}

/**
 * Validates a write/action value against the spec. Action values default to `1`. Throws
 * `InvalidValue`.
 */
export function assertValue(target: ResolvedName, value: unknown, op: ParamOperation): unknown {
  const actual = value === undefined && op === "action" ? 1 : value;
  if (!target.spec) throw new InvalidValue(target.name, actual, ["no value schema"]);
  const result = validateValue(target.spec, actual);
  if (!result.ok) throw new InvalidValue(target.name, actual, result.errors);
  return actual;
}

/** The command list for `Cp750Session.commands()`. */
export function describeCommands(policy: AccessPolicy): CommandInfo[] {
  const targets: ResolvedName[] = [];
  const seen = new Set<string>();
  for (const [name, spec] of Object.entries(policy.manifest?.params ?? {})) {
    seen.add(name);
    targets.push({ name, spec, availability: availabilityOf(policy, name) });
  }
  for (const name of policy.helpNames ?? []) {
    if (!seen.has(name)) targets.push({ name, spec: null, availability: "confirmed" });
  }
  return targets
    .filter(
      (t) => policy.allowInternal || !(t.spec?.internal || t.name.startsWith("cp750.internal.")),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const operations: ParamOperation[] = [];
      const blocked: CommandInfo["blocked"] = {};
      const applicable = t.spec
        ? OPERATIONS.filter((op) => isApplicable(t.spec, op))
        : ["read" as const];
      for (const op of applicable) {
        const reason = checkOperation(policy, t, op);
        if (reason) blocked[op] = reason;
        else operations.push(op);
      }
      return {
        name: t.name,
        source: t.spec ? "manifest" : "help",
        spec: t.spec,
        availability: t.availability,
        operations,
        blocked,
      };
    });
}

/** Read always applies; write only to readwrite params; action only to action params. */
function isApplicable(spec: ParamSpec | null, op: ParamOperation): boolean {
  if (op === "read") return true;
  if (!spec) return false;
  return op === "write" ? spec.access === "readwrite" : spec.access === "action";
}

/** True for lines `sendRaw` may send: `<name> ?` and the read-only single-word commands. */
export function isRawReadLine(line: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refuse embedded control characters
  if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(line)) return false;
  const text = line.trim().toLowerCase();
  if (RAW_COMMANDS.has(text)) return true;
  return /^cp750\.[a-z0-9_]+\.[a-z0-9_]+\s*\?$/.test(text);
}
