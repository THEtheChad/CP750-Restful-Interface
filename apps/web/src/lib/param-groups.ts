/**
 * Groups for the `cp750.sys.*` namespace, which holds ~310 of the CP750's params. An ordered
 * first-match rule table over the part after `cp750.sys.`, checked against every shipped
 * manifest by `param-groups.test.ts` (each name matches exactly one rule; few fall to Other).
 * A name no rule knows (a new firmware) lands in Other, never hidden.
 */

export interface SysGroupRule {
  key: string;
  label: string;
  match: RegExp;
}

export const SYS_GROUP_RULES: readonly SysGroupRule[] = [
  {
    key: "fader",
    label: "Fader & mute",
    match: /^(fader|fader_preset_\w+|mute|mute_fade_(in|out)_time)$/,
  },
  {
    key: "inputs",
    label: "Inputs",
    match: /^((analog|dig_\d|mic|non_sync)_\w+|input_mode|input_\d+_\d+_mute|power_on_input)$/,
  },
  {
    key: "decoding",
    label: "Decoding",
    match: /^(dolby_digital_\w+|pcm_\w+|two_channel_decode_mode|process_mode_\w+)$/,
  },
  { key: "eq", label: "Equalizer", match: /^eq_/ },
  {
    key: "calibration",
    label: "Room calibration",
    match:
      /^((bass_|treble_)?level_\w+|treble_freq_\w+|\w+_distance|distance_units|(pl_)?surround_delay|surround_boost\w*|subwoofer_filter|spl_room|alignment_mode|rta_channel|signal_gen_\w+|output_\w+)$/,
  },
  {
    key: "unit",
    label: "Unit & network",
    match:
      /^((automation|cinema_system|comment|cp|projector)_text|theater_name|auditorium_number|ip_setting|ntp_server|serial_number|lcd_contrast|time|time_update_int|log_content)$/,
  },
];

export const OTHER_GROUP = { key: "other", label: "Other" } as const;

/** `cp750.sys.dig_1_text` → `"dig_1_text"`; `null` outside `cp750.sys.`. */
function sysSuffix(name: string): string | null {
  const prefix = "cp750.sys.";
  return name.toLowerCase().startsWith(prefix) ? name.slice(prefix.length).toLowerCase() : null;
}

/** The rule a `cp750.sys.*` param falls under (Other when none), or `null` outside `sys`. */
export function sysGroupOf(name: string): { key: string; label: string } | null {
  const suffix = sysSuffix(name);
  if (suffix === null) return null;
  return SYS_GROUP_RULES.find((r) => r.match.test(suffix)) ?? OTHER_GROUP;
}

/** Equalizer channels in speaker order; unknown channels follow alphabetically. */
export const EQ_CHANNELS = ["l", "c", "r", "ls", "rs", "bsl", "bsr", "lfe"] as const;

const EQ_LABELS: Record<string, string> = {
  l: "L",
  c: "C",
  r: "R",
  ls: "Ls",
  rs: "Rs",
  bsl: "Bsl",
  bsr: "Bsr",
  lfe: "LFE (subwoofer)",
};

export interface EqBand {
  channel: string;
  /** The band's centre in Hz (`1_25k` → 1250), or `null` for non-band params (`lfe_q`). */
  hz: number | null;
  band: string;
}

/** `cp750.sys.eq_l_1_25k` → `{channel: "l", hz: 1250, band: "1_25k"}`; `null` if not EQ. */
export function eqBandOf(name: string): EqBand | null {
  const m = /^eq_([a-z]+)_(.+)$/.exec(sysSuffix(name) ?? "");
  if (!m?.[1] || !m[2]) return null;
  const band = m[2];
  const f = /^(\d+)(?:_(\d+))?(k?)$/.exec(band);
  const hz = f?.[1] ? Number(`${f[1]}.${f[2] ?? "0"}`) * (f[3] ? 1000 : 1) : null;
  return { channel: m[1], hz, band };
}

export function eqChannelLabel(channel: string): string {
  return EQ_LABELS[channel] ?? channel.toUpperCase();
}

export function eqChannelRank(channel: string): number {
  const i = (EQ_CHANNELS as readonly string[]).indexOf(channel);
  return i === -1 ? EQ_CHANNELS.length : i;
}

/** `1250` → `"1.25 kHz"`, `63` → `"63 Hz"`. */
export function formatHz(hz: number): string {
  return hz >= 1000 ? `${Number((hz / 1000).toFixed(2))} kHz` : `${hz} Hz`;
}
