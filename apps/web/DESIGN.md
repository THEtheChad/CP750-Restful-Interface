# CP750 web client: design rules

What the code can't say on its own. Values live in [`src/styles/tokens.css`](src/styles/tokens.css);
don't copy them here. Principles are borrowed from [Impeccable](https://impeccable.style)'s
Operate mode, without its tooling.

## Direction

Three references, chosen by the product owner:

| Reference | What it gives |
|---|---|
| Dolby CP950A front touchscreen | The tone: near-black ground, white type, mute beside one big level readout, status as dot + word. |
| UAD Console | The controls: a channel strip, a vertical fader with a printed scale, keys that light when on. |
| FabFilter Pro-Q 4 | The finish: the EQ is a curve you work on directly, a faint grid, quiet labels, plenty of air. |

What we took is the vocabulary, not the costume: no brushed metal or bevels, no glow halos, no
9px uppercase labels, no meters we can't back with data.

**Signature: everything is drawn as distance from reference.** The fader has no fill at 7.0; blue
from the level up to the 7.0 mark below it, amber from the mark up above it. Knobs and the EQ fill
from 0. At reference the screen is quiet.

## Use scene

A projectionist or tech in a dim booth, mid-show, on a touch panel, a phone, or a booth PC. A
wrong level or mute is audible to an audience. Consequences:

- **One dark theme.** Lifting the ground adds light spill; white body text is softened to `--text`.
- **Glance text ≥ 20px** (fader readout, mute state). Inputs never below 16px (phones zoom).
- **Targets ≥ 44px**; main controls ≥ 48px. Keys sit ≥ 6px apart.
- **At 390×844, the readout, Mute, fader and steps are visible without scrolling.**
- No decorative motion: 150ms ease-out for state changes only, off with `prefers-reduced-motion`.

## Shell

A labelled left rail (Home, Advanced, EQ, Settings; a WAI-ARIA tablist) that becomes a bottom tab
bar on phones. The status bar keeps connection and `host:port` always visible, chips only for
non-default modes, and the token. Banners are full-width strips under it, persistent while the
condition holds, with a one-line version on phones (the full sentence stays for screen readers).
Firmware, manifest, modes in full and meter availability are under Settings (and beside the
controls on wide Home screens).

## Keys

Every button is a key (`styles/controls.module.css`): a face with a little depth, a 1px `--edge`
(≥ 3:1), sinks 1px when pressed. Optional lamp: a dark slot when off, a solid colour when on, no
halo. Related keys sit in a recessed tray. Lit (selected, on) = light face with `--ink` text and a
check or lamp, never colour alone.

## Control surfaces by function

A param's control comes from what it does (`functionOf` in `src/lib/param-function.ts`), never
from its schema shape or where it appears. Home and Advanced share one surface per function, in a
glance size and a desk size:

| Function | Surface | Used by |
|---|---|---|
| level: fader unit | Glance: `VerticalFader` + `LevelSteps` tray. Desk: `LevelSteps` row. Both on `useLevelWriter`. No free-form entry. | main fader, `fader_preset_*` |
| toggle: 0/1 | `ToggleButton`: glance a square illuminated key (Mute) with its state word under it; desk a lamp key. Stable name, `aria-pressed`. | Mute, every 0/1 param |
| choice: enum | `ChoiceGroup`: glance a tray of lamp keys (input, with each input's fader preset); desk keys when ≤ 4 short options, else a list sent with Set. | input, short enums |
| trim: bipolar integer range | `Knob` + typed entry with Set. | level/bass/treble trims, EQ band rows |
| entry: number, range, text | `ParamControl`: a draft, sent with Set. | delays, text, everything else |

A new param kind gets a function and a surface here, not a one-off control.

## The fader

- The readout shows what the processor **confirmed**; the fill too. While a move is in progress a
  dashed cap shows the target and the readout says "Setting 7.4…".
- It **follows during the drag** (not on release): sends go out throttled, newest only, one in
  flight, each at most one page (1.0) from the last known level.
- A drag only starts **on the cap** (56px touch zone), so a scroll that lands on the track never
  sets the level. A tap on the track moves one page toward it, from a fresh read.
- It is draggable on phones too: a thumb on a touch screen is the ideal fader.
- Keys: arrows ±0.1, Page Up/Down ±1.0, Home/End to the ends (ramped). The wheel does nothing.
- Steps sit in a 2×2 tray beside the fader's lower half, louder on top; "Reset to 7.0" beneath,
  replaced by "At reference" in the same place once confirmed there.

### Safety invariants (in `useLevelWriter`; the UI must not bypass them)

- Steps re-read the processor and step from what it holds, one at a time.
- No send moves more than one page from the last known level; bigger moves ramp.
- Nothing is queued while the level is unknown; a failed send stops the move.
- A cancelled gesture drops what is queued instead of sending it.

## Knobs

Thin-arc knob (270° sweep, arc from 0, pointer line, zero tick). Drag up to increase, 8px per
step, Shift finer; one gesture moves at most `TRIM_GESTURE_LIMIT` (10 raw) from where it started.
On touch, the first tap selects the knob so the list keeps scrolling; then it drags. Arrows ±1,
Page Up/Down ±10. No Home/End, no wheel, no double-click reset: a level-trim reset could raise
output, so resets are typed changes in the field beside the knob.

## Equalizer

- One channel at a time; channel keys across the top; Curve or List.
- **Inspection by default.** "Edit EQ" turns on changes for the selected channel only and turns
  off when the channel changes. One band at a time; drags throttled, newest only.
- Straight segments between bands (we have band values, not a computed response); unread bands
  break the line; the y axis shows raw values: **the unit isn't documented, never claim dB.**
- The selected band's panel is docked under the plot (a floating one covers neighbours):
  previous/next, frequency, value, ±1, and "Set to 0…" with an inline old → new confirmation.
- Phones: 27 bands are ~13px apart, too close to drag; a row of frequency keys selects the band
  and the panel changes it.
- Without the full command set: one sentence saying so, never a flat line at 0.

## Colour jobs

| Colour | Job (and nothing else) |
|---|---|
| level (blue) | the level below reference, the selected EQ curve, lamps, focus |
| lit (light grey, ink text) | selected / on keys |
| danger (red) | muted, destructive, errors, processor/gateway down |
| warn (amber) | above reference, stale, degraded (draft manifest, non-default modes) |
| ok (green) | connected, verified |

Text ≥ 4.5:1; control edges ≥ 3:1 on ground, strip and raised. `--hairline` is a separator only.
Disabled uses `--disabled-*`, never opacity, and never hides state (a muted Mute stays red, the
current input stays lit).

## Type

Inter (bundled, works offline), sentence case everywhere. Weights: 400 body, 500 labels, 600
controls, 700 only for the fader readout, the selected tab and "Muted". Tabular figures for every
value; mono only for `cp750.*` identifiers.

## State matrix

Every control: default, hover, active (sinks), focus-visible, disabled. Plus:

| State | Looks like | Rule |
|---|---|---|
| pending write | dashed edge, soft tint, "Muting…" / "Switching…" / "Setting 7.4…" | The lit or confirmed look only after the processor answers. |
| stale | amber "Stale" by the value; the readout dims | Never presented as current. |
| blocked | lock + short label, full sentence (visible unless a banner or notice says it) | Full sentence is the control's `aria-describedby`. |
| unknown | `–`, "Unknown", no cap, no knob pointer | Never guess a value. |
| unreadable | "Not readable" | The gateway refuses reads. |

## Glossary

- **Reference:** fader 7.0 = 0 dB.
- **Full command set:** the CP750's extended parameters; refused unless the gateway runs with
  `CP750_ALLOW_FULL=1`. EQ, trims and meters are here.
- **Draft manifest:** a per-firmware command list not yet checked against a real unit; a banner
  says so and only params the unit's `help` lists can change.

## Bans

Uppercase/eyebrow labels. Side stripes. Glow halos. Bevelled metal. Nested cards. Glyph or emoji
icons (use `components/Icon`). Status chips for default states. Opacity for disabled. `title` as
the only carrier of information. Meters, units or dB values the processor hasn't given us.
Double-click or wheel changes to audio parameters. Modals where inline works.

## Adding a control

1. Give the param a function in `functionOf`; reuse that function's surface.
2. Use the key styles; don't restyle a button locally.
3. Cover every row of the state matrix, including pending and blocked with a reason.
4. Check 320px, 390px and desktop, keyboard only, and a touch drag on a phone.
