# Web UI refinement plan (apps/web)

Status: draft for council review. Branch `t3/refine-library-ui`, stacked on PR #1
(`t3/review-architecture-suggestions`). Scope: `apps/web` only — no API, server, or manifest
changes.

## Lens

We borrow from [Impeccable](https://impeccable.style) without installing it (no CLI, hooks,
PRODUCT.md/DESIGN.md machinery). What we take:

- **Mode = Operate.** The user is completing a task (set level, mute, pick input, inspect a
  param). Precision and restraint beat expression; standard controls, consistent vocabulary,
  every state designed (default/hover/focus/active/disabled/loading/error/empty).
- **Use scene decides everything.** A projectionist or tech in a dim booth, often on a touch
  panel or a phone, glancing from a distance mid-show. Generous targets, high contrast, dark mode
  first-class, no decorative motion.
- **Command passes we run, in order:** critique → distill → layout → typeset → clarify → harden
  → polish. Skipped: bolder/overdrive/delight/animate beyond state transitions.
- **Craft-floor bans we enforce:** no eyebrow/kicker labels, no side-stripe borders > 1px, no
  ghost cards (border + wide shadow), no glyph/emoji icons, no status-chip clutter, no
  everything-equal-weight, browser surfaces themed (selection, scrollbar, accent-color, caret).
- **One durable artifact:** a short `apps/web/DESIGN.md` recording tokens and the rules above, so
  later work stays consistent (Impeccable's `document`, hand-written and minimal).

## Critique of the current UI (evidence: screenshots of `bun run dev`, mock CP750)

Controls view
1. Card headings are uppercase, letter-spaced, muted ("FADER", "MUTE", "INPUT") — eyebrow labels.
   "MUTE" heading above a "Mute / OFF" button says the same thing twice.
2. Three identical bordered + shadowed cards; everything carries equal weight, so the fader (the
   primary control) doesn't lead.
3. Fader is a stock thin `<input type=range>` with no scale: you can't see where 7.0 (Dolby
   reference) sits, or how far you are from it. The disabled "7.0" button at nominal is a faded
   blue block that reads as broken.
4. Input buttons show both a label and the raw token (`dig_1`); "Last" and "Non-sync" are mixed in
   with physical inputs without distinction.

Status bar
5. Five uppercase key/value columns (Processor, Host, Firmware, Manifest, Mode) at equal weight.
   Firmware appears twice (Firmware + Manifest). "Read/write" and "Normal set" are chips that state
   the default — noise when nothing is wrong.
6. The yellow banner repeats the header's "⚠ unverified (draft)". ⚠ ✓ 🔒 are glyph icons.
7. Tabs are styled as large outlined/filled buttons detached from the header — they read as two
   actions, not navigation.

Advanced view (the worst offender)
8. 357 params; "System" alone holds 311 (192 are `eq_<channel>_<band>`). Opening it yields a
   ~56,000px page. Each row stacks name → description → control → reason vertically (~180px).
9. 277/357 params are full-tier and blocked. Every one repeats the same sentence ("🔒 Needs the
   CP750's full command set. Start the gateway with CP750_ALLOW_FULL=1…") under a disabled slider,
   an empty number field, and a disabled "Set".
10. Badges (`Full set`, `Read-only`, `Raw`, `Not in help`, aliases) compete with the name.
11. `ProblemMessage` uses a 6px left stripe.

## Changes

### A. Tokens and base (`styles/tokens.css`, `styles/controls.module.css`)
- Tighten type scale to a ~1.2 ratio in fixed rem; add `--text-xs`, `--text-2xl`, a display size
  for the fader readout (fixed steps by breakpoint, not `clamp`).
- Add a second neutral layer `--chrome` for the header/tab bar (slightly cooler than `--bg`).
- Elevation: one system — borders only on light surfaces; drop `--shadow` from cards.
- State vocabulary tokens: `--selected-bg/--selected-text`, `--hover`, `--pressed`, `--disabled-*`
  so every control uses the same states.
- Theme browser surfaces: `::selection`, `accent-color`, `caret-color`, `scrollbar-color`,
  `font-variant-numeric: tabular-nums` on data.
- Add a tiny inline-SVG icon component (`components/Icon/Icon.tsx`: lock, alert, check, chevron,
  speaker/speaker-off) in one 1.5px stroke style, replacing ⚠ ✓ 🔒 and the CSS chevron.

### B. Shell: status bar + tabs (`StatusBar`, `App`)
- Header becomes one `--chrome` bar: product name, then a single connection summary
  ("● Connected · 1.2.8.3 · 192.168.1.136") and the token control on the right. Host/port and
  manifest detail move into a disclosure ("Details") rather than five always-on columns.
- Mode chips appear **only when non-default** (Read-only, Full control) — absence = normal.
- Manifest trust shown once: as an inline status in the header ("Draft manifest" with alert icon,
  `title`/disclosure carrying the full sentence). The banner keeps only states that block work
  (gateway unreachable, processor offline, no manifest, read-only, token needed). The
  draft-manifest banner is demoted to the disclosure + Advanced intro, since writes still work for
  help-listed params. *(Council: is demoting it safe enough?)*
- Tabs become a standard underline tab bar attached to the bottom of the header (same WAI-ARIA
  tabs behaviour and keyboard handling; only styling changes).

### C. Controls view (`MainControls/*`)
- Layout: fader leads — wide left column, full card height; mute + input stacked right. Remove
  card shadows; keep one subtle surface + border. Sentence-case headings, normal tracking.
- Fader: keep every safety rail untouched (step-from-fresh-read, page-limited track clicks, no
  wheel, ramping). Visual only:
  - Readout `7.0` with `0.0 dB` as a secondary line; a "Δ from 7.0" hint when not nominal.
  - Styled range track (thicker, 44px touch height) with a **scale beneath it: ticks 0–10, the
    7.0 reference tick emphasised**. This is the one signature move — it reads like the
    processor's own fader scale and carries information (distance from reference).
  - The nominal button labelled "Reset to 7.0"; at nominal it shows a quiet "At reference" state
    instead of a disabled primary-blue block.
- Mute: one control. Heading "Mute" removed in favour of the button itself as the labelled
  control (heading kept visually-hidden for landmarks). Unmuted: neutral button "Mute" with
  speaker icon. Muted: full danger fill, "Muted" + speaker-off icon, text "Tap to unmute".
  `aria-pressed` semantics unchanged.
- Input: show the human label only; raw token moves to `title` (still searchable in Advanced).
  Physical inputs first, then "Last"/"Non-sync" separated by a small gap. Selected state uses the
  shared `--selected-*` tokens with a check icon so selection isn't colour-only.
- Stale badge: small alert icon + "Stale" in a quiet tone, not a bordered chip.

### D. Advanced view (`Advanced/*`)
- **Regroup `sys`**, client-side only, by name pattern into: Levels (fader/bass/treble/level/mute),
  Equalizer (`eq_*`, nested by channel: L, C, R, Ls, Rs, Bsl, Bsr, Sw…), Inputs & decoding
  (analog/dig/mic/non_sync/pcm/dolby/two_channel/process/surround/signal), Identity & network
  (`*_text`, ip, ntp, serial, lcd, theater/auditorium…), Other. Unknown names fall to Other, so a
  new firmware never hides a param. Namespace select gains these as options.
- **Dense rows**: a 3-column grid — [name + description] [value/control] [Read]. Description is
  one line, muted, truncates with full text in `title`. Target ≈56–64px per row on desktop; stacks
  on phones.
- **Locked rows are quiet**: when write is blocked, show the current value as text (no disabled
  slider/field/Set). A lock icon carries the reason (visually hidden text + `aria-describedby`,
  so a11y is preserved). The repeated reason sentence is replaced by **one notice at the top of
  Advanced**: "277 of 357 parameters need the full command set. Start the gateway with
  CP750_ALLOW_FULL=1 to change them." Reasons that differ from the common one still render inline.
- **"Only show changeable" filter** (checkbox next to search, off by default) to cut the list to
  what can actually be written.
- Badges: keep only Destructive (danger) and Read-only/Action as text-weight labels; aliases move
  into the description line; `Full set` is implied by the lock; `Raw`/`Not in help` remain as a
  quiet muted label.
- Range params: slider + number field on one line; Set/Undo appear only once dirty.
- `ProblemMessage`: full 1px border + danger-soft background + alert icon; no side stripe.

### E. Clarify (copy)
- Sentence case throughout; buttons name their action ("Reset to 7.0", "Read value",
  "Save token"); errors keep title + detail + code.
- Empty/filter states teach: "No parameters match ‘xyz’. Clear search" (button).

### F. Harden + verify
- Keep all existing a11y semantics (tabs pattern, aria-pressed, role=switch, aria-live banners,
  focus return on confirm). Update tests whose text selectors change (✓/⚠ glyph strings, mute
  label, reason text) — behaviour tests stay as-is.
- Check: 390px, 768px, 1440px; light + dark; keyboard-only path; contrast ≥4.5:1 for text,
  3:1 for control boundaries; `prefers-reduced-motion`; long param names/descriptions; gateway
  down, processor offline, read-only, auth-required states via the mock.
- `bun run check` green. Before/after screenshots in the PR.

### G. DESIGN.md
- ~1 page in `apps/web/DESIGN.md`: use scene, mode, tokens, state vocabulary, the bans list,
  the fader scale as the signature element, and "how to add a control".

## Out of scope / deferred
- An EQ matrix editor (channel × band grid). Worth doing later; grouping first.
- Theme toggle in-app (OS preference stays the source of truth).
- Any change to fader safety logic, API hooks, or server.

## Open questions for reviewers
1. Is demoting the "unverified draft manifest" banner into the header status + Advanced notice
   acceptable for operator safety, or must it stay a persistent banner?
2. Is client-side regrouping of `sys` by name pattern too clever/fragile? Alternative: keep
   namespaces and rely on the dense rows + "only changeable" filter.
3. Hiding host/port behind a disclosure — does the booth tech need it at a glance?
4. Anything in the Controls view that risks the fader's safety behaviour or muscle memory?

---

## Council revisions (astra · fable · wonderful) — these override the sections above

**Split.** PR A (this branch): §A, §B, §C, §E, §F, §G and the §D row/locked/scope work. PR B
(stacked on A): regrouping `sys` with an ordered first-match rule table in `lib/param-groups.ts`,
tested over both shipped manifests (one group per param, Other ≤ 10), a separate "Group"
control (not mixed into Namespace), EQ bands sorted by frequency, and EQ collapsed per channel.

**State honesty (astra P1, wonderful P0).**
- "At reference" / "+1.7 dB above reference" only when the reading is confirmed: no draft, no
  write in flight, not stale. Otherwise "Setting 7.0…" or the stale treatment.
- At reference the reset cell becomes non-interactive status text in the same grid cell (keeps
  position); otherwise a "Reset to 7.0" button with no `aria-label` override.
- Mute keeps the stable accessible name "Mute" + `aria-pressed`; visible state text is
  "Audio on" / "Muted" / "Muting…" / "Unmuting…" / "Unknown". No gesture copy.
- Input selection pending shows "Switching…"; unknown value selects nothing.
- Stale stays loud: the readout dims and a visible "Stale" label in `--warn` sits next to the
  value, outside any visually-hidden heading. Reason text stays in the DOM.
- Scale ticks are `aria-hidden` and `pointer-events: none`; the native range keeps its 3rem hit
  area and every handler (page-limit, wheel block, ramp, fresh-read steps).

**Header (astra P1, wonderful P1, fable P2).** `host:port` stays visible at every width and leads
the summary (identity before version). `ConnectionBadge` precedence unchanged. The unverified /
nearest / missing manifest warning stays a persistent compact strip in the always-rendered
`role="status"` region, naming nearest-match versions. Details disclosure (button +
`aria-expanded`, ≥44px) holds firmware, manifest, modes stated in full ("Read/write · Normal
set"), and the theme setting. Non-default modes also show as visible chips once the device is
known. Tabs stay outside `<header>` (no DOM-order/landmark change), restyled as an underline bar.

**Advanced (all three).**
- Scope control `Available N · Locked N · All` (radio group), default Available. "Locked" means
  the command's own `blocked` reason for its primary op (static, server-side); context reasons
  (offline, token, read-only mode) never hide rows. Search spans the selected scope; the count
  text stays `aria-live`.
- Locked rows show a visible terse label ("Locked · full set") with an `aria-hidden` icon; the
  full-tier sentence is said once in the notice at the top (with a "Show locked" action), other
  reasons stay as full inline sentences. The row's focusable Read button (or control) keeps
  `aria-describedby` → the full sentence.
- No value text is invented: unreadable rows say "Not readable"; unread rows "–"; unit hints kept.
- Rows: `minmax(0, …)` grid, names wrap (never truncate) with the `cp750.<ns>.` prefix muted,
  value column right-aligned, single column below 40rem, verified at 320px. Set stays always
  present; Read stays a text button ≥44px. One shared IntersectionObserver for all rows.

**Tokens (fable P0/P1, wonderful P1).** Dark is the default, with a System/Dark/Light setting
persisted in `localStorage`. Ink header in both themes. Colour jobs: accent = selection +
primary action; danger = muted + destructive; warn = above reference, stale, degraded;
ok = connected only. Control boundaries ≥3:1 in both themes; explicit `--disabled-*` colours
instead of opacity; 1px borders (2px only for selected/focus); spacing adds 3rem; weights
400/600/700 only; sans tabular numerals for values, mono only for `cp750.*` identifiers; inputs
never below 16px; touch targets ≥44px. `forced-colors` fallback for the styled range.

**Phone acceptance (fable P0).** At 390×844: header ≤56px, and readout, slider, steps and Mute
visible without scrolling (one manifest-warning strip present).
