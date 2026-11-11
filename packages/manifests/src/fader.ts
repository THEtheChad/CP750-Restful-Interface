/**
 * The CP750 fader curve (docs/ARCHITECTURE.md, "Device protocol"). Raw 0-100 is the 0.0-10.0
 * display. Raw 0-40 maps linearly from -90 to -10 dB; raw 40-100 maps linearly from -10 to +10 dB,
 * so raw 70 is 0 dB.
 */
export const FADER_MIN = 0;
export const FADER_MAX = 100;
export const FADER_KNEE = 40;
export const FADER_NOMINAL = 70;
export const FADER_MIN_DB = -90;
export const FADER_KNEE_DB = -10;
export const FADER_MAX_DB = 10;

const LOW_SLOPE = (FADER_KNEE_DB - FADER_MIN_DB) / (FADER_KNEE - FADER_MIN);
const HIGH_SLOPE = (FADER_MAX_DB - FADER_KNEE_DB) / (FADER_MAX - FADER_KNEE);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Converts a raw fader value (clamped to 0-100) to dB. */
export function faderToDb(raw: number): number {
  const r = clamp(raw, FADER_MIN, FADER_MAX);
  const db =
    r <= FADER_KNEE
      ? FADER_MIN_DB + (r - FADER_MIN) * LOW_SLOPE
      : FADER_KNEE_DB + (r - FADER_KNEE) * HIGH_SLOPE;
  return Math.round(db * 100) / 100;
}

/** Converts dB (clamped to -90..+10) to the nearest raw fader integer. */
export function dbToFader(db: number): number {
  const d = clamp(db, FADER_MIN_DB, FADER_MAX_DB);
  const raw =
    d <= FADER_KNEE_DB
      ? FADER_MIN + (d - FADER_MIN_DB) / LOW_SLOPE
      : FADER_KNEE + (d - FADER_KNEE_DB) / HIGH_SLOPE;
  return Math.round(raw);
}
