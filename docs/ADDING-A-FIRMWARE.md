# Adding a firmware

The gateway picks a manifest by the firmware the unit reports (`cp750.sysinfo.version`). Without
an exact, verified manifest it falls back to the nearest older one as a **draft**: reads work, but
writes are limited to params the unit's own `help` lists. This guide takes a new firmware from a
capture to a checked-in manifest, and says when that manifest may be called `verified`.

You need a CP750 running the new firmware, reachable over TCP port 61408, and this repository
(`bun install`). A compiled `cp750` executable works the same way as `bun apps/server/src/cli.ts`.

## 1. Capture

```sh
bun apps/server/src/cli.ts capture --host 192.168.1.136 --out ./captures
```

Capture reads the version, then `help` and `status`. It then sets `cp750.ctrl.full_ascii_ctrl 1`
(the full command set for this session only; no audio changes), reads `help` and `status` again,
sets it back to `0`, and sends `exit`. It writes nothing else to the unit, but do it outside a
screening anyway.

It writes:

```
captures/
  1.3.0.5.json            draft manifest (the firmware is the file name)
  1.3.0.5/
    version.txt           the raw version reply line
    help.txt              help, normal command set
    status.txt            status, normal command set
    help-full.txt         help with full_ascii_ctrl 1 (missing if the unit refused full control)
    status-full.txt       status with full_ascii_ctrl 1 (likewise)
```

Keep the text files: they are the evidence the manifest is checked against. `captures/` itself
is a valid manifest directory, so you can try the draft straight away:

```sh
CP750_MANIFEST_DIR=./captures bun apps/server/src/cli.ts serve
```

`GET /api/device` should report the new firmware with `match: "exact"`, `verified: false`.

## 2. Review the draft

The draft starts from the nearest built-in manifest: each name the capture saw takes that
manifest's spec. Its `sources[0].notes` says which manifest that was and how many names were new.

**Unknown params.** A name the base manifest does not have is typed as a read-only string, with
`"accessSource": "observed"` and the description "Seen in a capture; not in the built-in
manifest". List them:

```sh
jq -r '.params | to_entries[] | select(.value.accessSource == "observed") | .key' captures/1.3.0.5.json
```

For each one decide, from `status*.txt` (its current value), `help*.txt` (the value list `help`
prints, if any) and the manual:

- `value`: an integer range (`minimum`/`maximum`), an enum, or a string (see the table in
  [ARCHITECTURE.md](ARCHITECTURE.md#manifests-one-per-firmware)). Leave a plain string only for
  free text.
- `access`: `readonly` unless you know the unit accepts writes; `action` for `cp750.ctrl.*`
  triggers. Set `accessSource` to `manual` (the manual says so), `observed` (you saw the unit
  accept or ignore a write) or `inferred`.
- `unit` (integers only), `destructive: true` (actions only; reboot-like), `internal: true`
  (`cp750.internal.*`).
- `description`: your own words. Do not paste manual text.

**Tiers.** When the full-set capture showed names the normal one did not, the draft's tiers come
from the capture (seen with the normal set: `normal`; only with the full set: `full`). Otherwise
they are copied from the base manifest; check them against the two `help` files.

**What disappeared.** Params of the base manifest that the unit's `help` no longer lists are left
out of the draft. Compare the two to see what changed:

```sh
diff <(jq -S '.params | keys' packages/manifests/firmware/1.2.8.3.json) \
     <(jq -S '.params | keys' captures/1.3.0.5.json)
```

**Sources.** Replace the capture's `ref` (host and time) with `captures/<firmware>/`, and say in
`notes` what you reviewed and what is still a guess. Keep a `manual` source for anything taken
from the manual.

## 3. Draft or verified

A manifest stays `"status": "draft"` until **all** of these hold:

1. The capture files are checked in under `packages/manifests/captures/<firmware>/`
   (`version.txt`, `help.txt`, `status.txt`, and the `-full` files when the unit allowed full
   control).
2. `sources` has `{ "kind": "capture", "ref": "captures/<firmware>/" }`.
3. `help` was cross-checked: every param in the manifest appears in `help.txt` or `help-full.txt`,
   and every `cp750.*` name there is in the manifest.
4. Tiers match the two `help` listings, and no unknown param is left as a placeholder string
   without a reason in `notes`.

Points 1–3 are enforced by `packages/manifests/test/manifests.test.ts`. A manual alone, however
careful the transcription, is not enough: the manual and the firmware disagree in places.

A draft is still useful: the gateway allows writes to the params the unit's `help` confirms.

## 4. Add it to the repository

```sh
cp captures/1.3.0.5.json packages/manifests/firmware/
mkdir -p packages/manifests/captures/1.3.0.5
cp captures/1.3.0.5/*.txt packages/manifests/captures/1.3.0.5/
```

The file must be named `<firmware>.json`, and its `$schema` stays
`../schema/cp750-manifest.v1.schema.json`. Then regenerate and check:

```sh
bun run gen      # src/generated/: the ParamName types and builtin.ts, which embeds the manifest
bun run check    # lint, typecheck, codegen/OpenAPI drift, all tests
```

`bun run gen` is what makes the new file a built-in (and part of the compiled executable).
`bun run check` validates it against the meta-schema and the semantic checks (value schemas
compile, `minimum <= maximum`, integer enums within range, units only on integers, `destructive`
only on actions, `cp750.internal.*` marked `internal`, no alias collisions), and, for a
`verified` manifest, the capture checks above. Add a test to
`packages/manifests/test/manifests.test.ts` for anything notable about this firmware (new or
removed params, changed tiers).

Commit as `feat(manifests): add firmware 1.3.0.5 (draft)` (or `(verified)`).

To use a manifest without rebuilding, put it in a directory and point `CP750_MANIFEST_DIR` at it
instead; a file there with the same firmware as a built-in replaces the built-in.
