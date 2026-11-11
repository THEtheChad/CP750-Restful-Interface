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

/**
 * Why `op` on `command` is disabled right now, or `null` if the control can be used. The server's
 * own `blocked` reason wins; then the global conditions.
 */
export function blockReason(
  command: Command | undefined,
  op: Operation,
  { device, hasToken }: BlockContext,
): string | null {
  if (!device) return "Waiting for the gateway…";
  if (!command) {
    return device.manifest
      ? "This firmware doesn't have this parameter."
      : "Waiting for firmware detection…";
  }
  const blocked = command.blocked[op];
  if (blocked) return reasonText(blocked, op);
  if (!command.operations.includes(op)) {
    return op === "read" ? "This parameter can't be read." : "This parameter can't be changed.";
  }
  if (op === "read") return device.connection === "connected" ? null : "The processor is offline.";
  if (device.readOnly) return reasonText("read-only-mode", op);
  if (device.connection !== "connected") return "The processor is offline.";
  if (device.authRequired && !hasToken) return "Enter the API token to make changes.";
  return null;
}
