/**
 * Plain-language explanations for refused operations: the `blocked` reasons from
 * `GET /api/commands` plus the client-side conditions (read-only, disconnected, no token).
 */
import type { BlockedReason, Command, Device, Operation } from "../api/types.ts";

export function reasonText(reason: BlockedReason, op: Operation): string {
  switch (reason) {
    case "full-tier":
      return "Needs the CP750's full command set. Start the gateway with CP750_ALLOW_FULL=1 to use it.";
    case "internal":
      return "Internal parameter. Only available when the gateway runs with CP750_ALLOW_INTERNAL=1.";
    case "access":
      return op === "action"
        ? "This parameter is not an action."
        : op === "write"
          ? "This parameter is read-only."
          : "This parameter can't be read.";
    case "read-only-mode":
      return "The gateway is in read-only mode.";
    case "unverified":
      return "The firmware manifest is unverified and the unit's help doesn't list this parameter, so changes are blocked.";
    case "confirmation-required":
      return "Destructive: needs an explicit confirmation.";
    case "raw-only":
      return "Not in the firmware manifest; it can only be read.";
    case "raw-command":
      return "Only read-only raw commands are allowed.";
    case "unavailable":
      return "The unit's help doesn't list this parameter, so it isn't available.";
  }
}

export interface BlockContext {
  device: Device | undefined;
  hasToken: boolean;
}

/** Client-side conditions, on top of the server's `BlockedReason`s. */
export type BlockCode =
  | BlockedReason
  | "waiting"
  | "missing"
  | "not-supported"
  | "offline"
  | "token";

export interface BlockInfo {
  code: BlockCode;
  /** The full, plain-language explanation. */
  text: string;
  /** A two- or three-word label for dense lists ("Full set", "Offline"). */
  short: string;
  /**
   * Already explained once on screen (a status banner, or the full-set notice atop the parameter
   * list), so dense lists can show `short` and keep `text` for assistive tech only.
   */
  explainedElsewhere: boolean;
}

const SHORT: Record<BlockCode, string> = {
  "full-tier": "Full set",
  internal: "Internal",
  access: "Not supported",
  "read-only-mode": "Read-only mode",
  unverified: "Unverified",
  "confirmation-required": "Needs confirmation",
  "raw-only": "Read only",
  "raw-command": "Read only",
  unavailable: "Not in help",
  waiting: "Waiting",
  missing: "Not in firmware",
  "not-supported": "Not supported",
  offline: "Offline",
  token: "Needs token",
};

/** Explained by a banner (StatusBanners) or by the Advanced view's full-set notice. */
const EXPLAINED_ELSEWHERE = new Set<BlockCode>([
  "full-tier",
  "read-only-mode",
  "waiting",
  "offline",
  "token",
]);

function info(code: BlockCode, text: string): BlockInfo {
  return { code, text, short: SHORT[code], explainedElsewhere: EXPLAINED_ELSEWHERE.has(code) };
}

/**
 * Why `op` on `command` is disabled right now, or `null` if the control can be used. The server's
 * own `blocked` reason wins; then the global conditions.
 */
export function blockInfo(
  command: Command | undefined,
  op: Operation,
  { device, hasToken }: BlockContext,
): BlockInfo | null {
  if (!device) return info("waiting", "Waiting for the gateway…");
  if (!command) {
    return device.manifest
      ? info("missing", "This firmware doesn't have this parameter.")
      : info("waiting", "Waiting for firmware detection…");
  }
  const blocked = command.blocked[op];
  if (blocked) return info(blocked, reasonText(blocked, op));
  if (!command.operations.includes(op)) {
    return info(
      "not-supported",
      op === "read" ? "This parameter can't be read." : "This parameter can't be changed.",
    );
  }
  if (op === "read") {
    return device.connection === "connected" ? null : info("offline", "The processor is offline.");
  }
  if (device.readOnly) return info("read-only-mode", reasonText("read-only-mode", op));
  if (device.connection !== "connected") return info("offline", "The processor is offline.");
  if (device.authRequired && !hasToken)
    return info("token", "Enter the API token to make changes.");
  return null;
}

/** `blockInfo` as just its text. */
export function blockReason(
  command: Command | undefined,
  op: Operation,
  context: BlockContext,
): string | null {
  return blockInfo(command, op, context)?.text ?? null;
}
