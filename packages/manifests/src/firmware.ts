const FIRMWARE_PATTERN = /^\d+(\.\d+)*$/;

/** True when `value` is a dot-separated list of non-negative integers, e.g. `1.0.0.150183`. */
export function isFirmwareVersion(value: string): boolean {
  return FIRMWARE_PATTERN.test(value.trim());
}

/** Splits a firmware string into its numeric parts (as digit strings without leading zeros). */
function firmwareParts(value: string): string[] {
  const trimmed = value.trim();
  if (!FIRMWARE_PATTERN.test(trimmed)) {
    throw new TypeError(`Not a firmware version: ${JSON.stringify(value)}`);
  }
  return trimmed.split(".").map((part) => part.replace(/^0+(?=\d)/, ""));
}

function comparePart(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Compares two firmware versions numerically, part by part, for any number of parts and any part
 * size. Missing trailing parts count as 0, so `1.2` equals `1.2.0`. Returns -1, 0 or 1.
 * Throws a `TypeError` for strings that are not firmware versions.
 */
export function compareFirmware(a: string, b: string): -1 | 0 | 1 {
  const left = firmwareParts(a);
  const right = firmwareParts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const result = comparePart(left[i] ?? "0", right[i] ?? "0");
    if (result !== 0) return result < 0 ? -1 : 1;
  }
  return 0;
}
