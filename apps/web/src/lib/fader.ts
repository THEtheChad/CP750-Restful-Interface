/**
 * The CP750 main fader: raw 0–100 is the 0.0–10.0 display, and 7.0 (raw 70) is nominal 0 dB. The dB
 * value itself always comes from the API (`ParamReading.db`); this module only formats.
 */
export const FADER_MIN = 0;
export const FADER_MAX = 100;
export const FADER_NOMINAL = 70;
/** One page: 1.0 on the display (10 raw). The most a track click or a single send may move. */
export const FADER_PAGE = 10;

/** Typographic minus: easier to read from across a booth than a hyphen. */
const MINUS = "−";

export function clampFader(raw: number): number {
  if (!Number.isFinite(raw)) return FADER_NOMINAL;
  return Math.min(FADER_MAX, Math.max(FADER_MIN, Math.round(raw)));
}

/** Raw fader value as the unit's display shows it: `70` → `"7.0"`. */
export function formatFader(raw: number): string {
  return (clampFader(raw) / 10).toFixed(1);
}

/** `-10` → `"−10.0 dB"`, `3.33` → `"+3.3 dB"`, `0` → `"0.0 dB"`; unknown → `"– dB"`. */
export function formatDb(db: number | null | undefined): string {
  if (db === null || db === undefined || !Number.isFinite(db)) return "– dB";
  const rounded = Math.round(db * 10) / 10;
  if (rounded === 0) return "0.0 dB";
  return `${rounded > 0 ? "+" : MINUS}${Math.abs(rounded).toFixed(1)} dB`;
}

/** Steps a raw value by a display delta (`0.1` → 1 raw, `1.0` → 10 raw), clamped. */
export function stepFader(raw: number, displayDelta: number): number {
  return clampFader(raw + Math.round(displayDelta * 10));
}
