/**
 * What a param does, which decides the control surface it gets everywhere it appears (the main
 * controls and the Advanced list alike). One function, one surface:
 *
 * - `level`: a fader-unit param (the main fader, the fader presets). Stepped only: ±0.1/±1.0
 *   from a fresh read, and a reset that ramps one page per send. Never a free-form jump.
 * - `toggle`: a 0/1 param. One press toggles; pending and confirmed look different.
 * - `choice`: an enum. In the dense Advanced list, options that fit on one line (≤ 4, short) are
 *   segmented buttons, one press chooses, like the input selector; longer enums are a list sent
 *   with Set. (The main input selector, with room to spare, always uses segments.)
 * - `trim`: a bipolar integer range (level, bass, treble trims; EQ bands): a knob that moves at
 *   most `TRIM_GESTURE_LIMIT` per gesture, with typed entry beside it.
 * - `entry`: a number, range or text, edited as a draft and sent with Set.
 */
import type { Command, ParamValue } from "../api/types.ts";
import { formatFader } from "./fader.ts";
import { controlFor } from "./schema-control.ts";

/** The most one knob gesture may move a trim (raw units), from where the gesture started. */
export const TRIM_GESTURE_LIMIT = 10;

export const MAIN_PARAMS = {
  fader: "cp750.sys.fader",
  mute: "cp750.sys.mute",
  input: "cp750.sys.input_mode",
} as const;

/** Segmented buttons (in dense lists) up to this many options and this many label characters. */
export const SEGMENT_MAX_OPTIONS = 4;
export const SEGMENT_MAX_CHARS = 40;

/** The words a toggle uses for its states, and the colour job of "on". */
export interface ToggleVocabulary {
  on: string;
  off: string;
  turningOn: string;
  turningOff: string;
  /** Mute's "on" is the danger state; any other toggle's is a selection (accent). */
  onTone: "danger" | "accent";
}

export const MUTE_VOCABULARY: ToggleVocabulary = {
  on: "Muted",
  off: "Audio on",
  turningOn: "Muting…",
  turningOff: "Unmuting…",
  onTone: "danger",
};

export const ON_OFF_VOCABULARY: ToggleVocabulary = {
  on: "On",
  off: "Off",
  turningOn: "Turning on…",
  turningOff: "Turning off…",
  onTone: "accent",
};

export type ParamFunction =
  | { kind: "level" }
  | { kind: "toggle"; vocabulary: ToggleVocabulary }
  | { kind: "choice"; options: (string | number)[]; layout: "segments" | "list" }
  | { kind: "trim"; min: number; max: number }
  | { kind: "entry" }
  | { kind: "none" };

export function functionOf(command: Pick<Command, "name" | "unit" | "schema">): ParamFunction {
  const spec = controlFor(command.schema);
  if (command.unit === "fader" && (spec.kind === "range" || spec.kind === "number")) {
    return { kind: "level" };
  }
  switch (spec.kind) {
    case "switch":
      return {
        kind: "toggle",
        vocabulary: command.name === MAIN_PARAMS.mute ? MUTE_VOCABULARY : ON_OFF_VOCABULARY,
      };
    case "select": {
      const short =
        spec.options.length <= SEGMENT_MAX_OPTIONS &&
        spec.options.reduce<number>((n, o) => n + String(o).length, 0) <= SEGMENT_MAX_CHARS;
      return { kind: "choice", options: spec.options, layout: short ? "segments" : "list" };
    }
    case "none":
      return { kind: "none" };
    case "range":
      // A bipolar trim (level, bass, treble, EQ band): a knob, with typed entry beside it.
      // Unipolar ranges (delays in ms, counts) stay typed entries.
      return spec.min < 0 && spec.max > 0 && (command.unit === null || command.unit === "dB_tenths")
        ? { kind: "trim", min: spec.min, max: spec.max }
        : { kind: "entry" };
    default:
      return { kind: "entry" };
  }
}

export interface ToggleState {
  known: boolean;
  on: boolean;
  /** `undefined` while unknown. */
  tone: "on" | "off" | "pending" | undefined;
  /** The visible state word ("Muted", "Turning on…", "Unknown"). */
  word: string;
}

/** A 0/1 param's state for display. While pending, `value` is already the optimistic target. */
export function toggleState(
  value: unknown,
  pending: boolean,
  vocabulary: ToggleVocabulary,
): ToggleState {
  const known = value === 0 || value === 1;
  const on = value === 1;
  if (!known) return { known, on, tone: undefined, word: "Unknown" };
  if (pending) {
    return { known, on, tone: "pending", word: on ? vocabulary.turningOn : vocabulary.turningOff };
  }
  return { known, on, tone: on ? "on" : "off", word: on ? vocabulary.on : vocabulary.off };
}

/** A value shown as text (read-only rows), in its function's terms: `7.0`, `On`, the raw rest. */
export function formatValueFor(fn: ParamFunction, value: ParamValue): string {
  if (fn.kind === "level" && typeof value === "number") return formatFader(value);
  if (fn.kind === "toggle" && (value === 0 || value === 1)) {
    return value === 1 ? fn.vocabulary.on : fn.vocabulary.off;
  }
  return String(value);
}
