# CP750 web client: design rules

What the code can't say on its own. Values live in [`src/styles/tokens.css`](src/styles/tokens.css);
don't copy them here. The principles are borrowed from [Impeccable](https://impeccable.style)'s
Operate mode, without its tooling.

## Use scene

A projectionist or tech in a dim booth, mid-show, on a touch panel, a phone, or a booth PC. They
glance at the screen; mistakes are audible to an audience. Consequences:

- **Dark is the default theme.** Light and System are in Details → Theme.
- **Glance text ≥ 20px** for anything read mid-task (fader readout, mute state). Inputs never
  below 16px, or phones zoom on focus.
- **Targets ≥ 44px**; the main controls are ≥ 48px.
- **At 390×844 the fader, its steps and Mute are visible without scrolling.**
- No decorative motion. Transitions are 150 ms, ease-out, state only, and respect
  `prefers-reduced-motion`.

## Two densities

- **Controls, "glance":** fader, mute and input. Big, few, no cards; regions are separated by
  space and one hairline.
- **Advanced, "desk":** the full manifest as dense rows: [name + description + why it's blocked]
  [value or control] [Read]. Names wrap at `_` and are never truncated. Phones stack to
  [name · Read] [control].

## Colour jobs

| Colour | Job (and nothing else) |
|---|---|
| accent | selection, primary action, focus |
| danger | muted, destructive, errors, processor/gateway down |
| warn | above reference, stale, degraded (unverified manifest, non-default modes) |
| ok | connected, verified |
| chrome | the ink header, the same in both themes, with its own `--chrome-*` status colours |

- Text ≥ 4.5:1, and control boundaries (`--border-strong`) ≥ 3:1 on every surface, in both themes.
  `--border` is a hairline separator, never a control's only edge.
- Disabled uses `--disabled-*`, never opacity.
- Disabled never hides state: a muted Mute stays red, the current input stays selected, and an on
  switch stays on.

## Type

One sans family. Weights: 400 body and descriptions, 600 controls and headings, 700 only for the
fader readout, the selected tab and the muted state. Values use sans with `tabular-nums`. Mono is
only for `cp750.*` identifiers, hosts and firmware versions. Headings are sentence case: no
uppercase labels, no eyebrows.

## State matrix

Every control has default, hover, focus-visible, active and disabled states. Plus these
app-specific states:

| State | Looks like | Rule |
|---|---|---|
| pending write | dashed border, soft tint, "Muting…" / "Switching…" / "Setting 7.4…" | The solid confirmed look only appears after the processor answers. |
| stale | warn "Stale" label next to the value; the readout dims | Never presented as current. The reason is in the label's text. |
| blocked | lock icon + short label ("Full set", "Offline") and the full sentence | The full sentence is visible unless a banner or the list notice already says it. Then it stays visually hidden, as the control's `aria-describedby` target. |
| unknown | `–`; "Unknown" for mute; no input selected | Never guess a value. |
| unreadable | "Not readable" | The gateway refuses reads for this param. |

Accessible names stay stable: Mute is always "Mute" (state is `aria-pressed`), and the reset
button is "Reset to 7.0". At confirmed reference, the reset button's cell becomes "At reference"
status text in the same place.

## The fader scale (the one signature element)

A styled native range (`src/styles/range.module.css`) with a 0–10 scale under it. Ticks are 1px;
the 7 (Dolby reference) tick is 2px and taller, and its label is bold. The fill is accent up to the
value, and warn for the part above 7.0. The scale is `aria-hidden` and `pointer-events: none`.
Advanced sliders reuse the same range without the scale. Don't invent another slider.

## Fader safety invariants (the UI must not break them)

- The step buttons re-read the processor and step from what it holds, one step at a time.
- A press on the track moves at most one page (±1.0) toward the press.
- The mouse wheel never moves it.
- No single send moves more than one page; bigger moves ramp.
- Writes are throttled to the newest value only, with one in flight. The final value is committed
  on release.

## Glossary

- **Reference:** fader 7.0, which is 0 dB.
- **Full command set:** the CP750's extended parameters. The gateway refuses them unless it was
  started with `CP750_ALLOW_FULL=1`; they are listed under Advanced → Locked.
- **Draft manifest:** a per-firmware command list that hasn't been checked against a real unit.
  While one is in use, a persistent banner says so and only params the unit's `help` lists can be
  changed.

## Bans

Eyebrow and uppercase labels. Side-stripe borders. A border plus a wide shadow on cards. Nested
cards. Glyph or emoji icons (use `components/Icon`, one 2px stroke set). Status chips for default
states. Opacity for disabled. `title` as the only carrier of information (it's invisible on
touch). Modals where inline works.

## Adding a control

1. Use `styles/controls.module.css` (or `range.module.css`). Don't restyle a button locally.
2. Cover every row of the state matrix, including pending and blocked with a reason.
3. Use the colour jobs above. Add a token only if it is reused.
4. Check both themes, 320px wide, and keyboard only.
