# Architecture

A REST + SSE gateway for the Dolby CP750 Digital Cinema Processor, a typed
per-firmware command registry ("manifests"), and a web client. It ships as a
single executable built with `bun build --compile`.

This document is the contract between the packages. If code and this file
disagree, fix one of them in the same change.

## Runtime and tooling

- **Bun** (pinned in `.bun-version` and `packageManager`) is the runtime, the
  package manager (`bun.lock`), the test runner (`bun test`) and the compiler
  (`bun build --compile`). Using Bun instead of the usual pnpm/Node is
  deliberate: the goal is a single self-contained executable for a
  projection-booth PC.
- TypeScript strict, ESM only, **named exports only** (no default exports
  unless a framework forces one, e.g. a Vite config).
- Biome for lint and format.
- Bun workspaces:

```
packages/manifests   @cp750/manifests  meta-schema, firmware manifests, loader,
                                        version compare, value codec, codegen'd types
packages/device      @cp750/device     TCP transport, protocol client, session
                                        (firmware detection + manifest selection),
                                        manifest-driven mock CP750 (TCP server)
apps/server          @cp750/server     Hono HTTP API, OpenAPI generation, SSE,
                                        config, CLI (serve | capture | query), compile entry
apps/web             @cp750/web        Vite + React + TanStack Query client
openapi/cp750.openapi.json             generated, committed; CI fails on drift
```

Code only depends downward: `web → (openapi spec)`, `server → device → manifests`.

## Device protocol (facts from Dolby manual 9110270, Issue 4 §6.2, and Issue 5 §7.2)

- Plain ASCII over TCP port **61408** (RS-232 at 9600 8N1 uses the same command set).
  There's no CRC, no sync bytes, no framing protocol, and **no echo** on Ethernet.
- Commands aren't case sensitive, and whitespace on input lines is ignored.
- Set: `<param> <value>`. The unit replies `<param> <value>` with the value it now holds.
- Query: `<param> ?`. The unit replies `<param> <value>`.
- **Unrecognized value**: no action, and the unit replies with the parameter's
  current status. A rejected write therefore looks like a normal reply. The
  client **must compare the echoed value to the requested value**.
- **Unrecognized parameter**: the unit replies with a blank line. No error
  messages are ever generated.
- Single-word commands: `help` (lists commands), `status` (all parameters;
  third-party clients report the `param : value` form), `dump_log`,
  `dump_log_100`, `exit` (closes the session).
- Replies may contain NUL bytes. Strip them.
- **20** simultaneous TCP sessions. The 21st kicks the oldest, which gets a
  warning message. Keep **one** persistent connection and serialize requests
  on it (one in flight).
- Command terminator: not specified by the manual. Open-source clients send LF
  and Christie documents CR. Default to `\r\n` (whitespace is ignored) and make
  it configurable.
- **Normal vs full command set**: the full set (Table 6-2) is only available
  while `cp750.ctrl.full_ascii_ctrl` is `1`. Every normal command is also in
  the full table. Manifests mark each param with `tier: "normal" | "full"`.
- Factory network defaults: IP 192.168.1.136, mask 255.255.255.128,
  gateway 192.168.1.129.
- Fader: raw 0–100 means display 0.0–10.0, and 7.0 (raw 70) is nominal 0 dB.
  The curve is piecewise linear: raw 0–40 goes from −90 to −10 dB (20 dB per
  1.0), and raw 40–100 goes from −10 to +10 dB (≈3.33 dB per 1.0). The manual
  misprints the upper bound as "−10"; +10 is the only value consistent with
  0 dB at 7.0.
- Mute fade in/out: 200–5000 ms.
- In Issue 4, `cp750.sys.mute` and the mute fade times are listed **only** in
  Table 6-2, so the 1.0.0.150183 manifest has them as `full` tier. Reading or
  writing mute on that firmware therefore needs `CP750_ALLOW_FULL=1`, and the
  default poll skips it otherwise. A capture from a real unit should settle this.

## Manifests: one per firmware

- `packages/manifests/schema/cp750-manifest.v1.schema.json` is the
  **meta-schema** (JSON Schema 2020-12) that every manifest must validate
  against. The format version is part of the file name; breaking changes mean a
  new `v2` file.
- `packages/manifests/firmware/<firmware>.json`, e.g. `1.0.0.150183.json`.

Manifest shape (top level):

```jsonc
{
  "$schema": "../schema/cp750-manifest.v1.schema.json",
  "manifestVersion": 1,
  "firmware": "1.0.0.150183",
  "status": "verified" | "draft",          // draft = not checked against a real unit's `help`
  "sources": [{ "kind": "manual" | "capture", "ref": "Dolby 9110270 Issue 4, Tables 6-1/6-2", "notes": "..." }],
  "params": {
    "cp750.sys.fader": {
      "tier": "normal" | "full",
      "access": "readwrite" | "readonly" | "action",
      "accessSource": "manual" | "inferred" | "observed",
      "value": { /* JSON Schema 2020-12 for the JSON value, e.g. {"type":"integer","minimum":0,"maximum":100} */ },
      "unit": "fader" | "ms" | "us" | "dB_tenths" | "feet_or_meters",   // optional; closed set in v1
      "destructive": true,            // optional; reboot, default_params, log_erase, save_params…
      "internal": true,               // optional; cp750.internal.* hidden and blocked by default
      "aliases": ["version"],         // optional
      "description": "..."            // optional, our own words (do not paste manual prose)
    }
  },
  "commands": ["help", "status", "dump_log", "dump_log_100", "exit"]
}
```

Value schemas:

| Manual notation | JSON value schema |
|---|---|
| `a to b` (integers) | `{"type":"integer","minimum":a,"maximum":b}` |
| `0, 1` | `{"type":"integer","enum":[0,1]}` |
| `x \| y \| z` | `{"type":"string","enum":["x","y","z"]}` |
| `[L R C Sw Ls Rs 7 8]` (route lists) | `{"type":"string"}` + `"x-format":"route-list"` (format unverified) |
| `[ip.ip.ip.ip nm.nm.nm.nm gw.gw.gw.gw off\|on hostname]` | `{"type":"string"}` + `"x-format":"ip-setting"` |
| blank (text and status fields) | `{"type":"string"}` |

The meta-schema only allows these shapes: `{"type":"integer"}` with optional
`minimum`, `maximum` and `enum`, or `{"type":"string"}` with optional `enum`,
`maxLength` and `x-format`. `x-format` is a key inside the value schema. Ajv
treats it as an annotation only. Beyond the meta-schema, the loader also
rejects value schemas that don't compile, `minimum > maximum`, a
`cp750.internal.*` param without `internal: true`, and aliases that collide.

- **Codec** (`@cp750/manifests`): `encode(param, jsonValue) → wire string` and
  `decode(param, wireString) → jsonValue`. Integers are sent as decimal, and
  enums and strings are sent as-is. `decode` must accept the unit's casing and
  whitespace. Unit helpers (`faderToDb`, `dbToFader`) live here too.
- **Access is mostly inferred**, because the manual doesn't mark read-only
  params. Defaults: `cp750.state.*` and `cp750.sysinfo.*` are `readonly`;
  `cp750.ctrl.*` is `action`; everything else is `readwrite`. Record
  `accessSource` honestly. Exceptions, still `inferred`: `cp750.internal.save_params`
  is an `action` (it's a trigger), and `cp750.sys.serial_number` is `readonly`
  (it's read-only when unsure).
- **Version compare**: firmware strings are dot-separated integers of any
  length (`1.0.0.150183`, `1.2.8.3`). Compare them numerically, part by part.
  Missing trailing parts count as 0, so `1.2` equals `1.2.0`.
- **Types**: a codegen step (`bun run gen`) emits TypeScript from each manifest
  (a `ParamName` union per firmware plus a value type per param) into
  `packages/manifests/src/generated/`, committed. CI fails if it's stale. The
  same step emits `generated/builtin.ts`, the static JSON imports of every
  `firmware/*.json`, so adding a firmware file only takes `bun run gen`. Those
  imports are what `bun build --compile` embeds.
- **Runtime validation** uses Ajv (2020 dialect) on each param's `value`
  schema.
- Extra manifests can be loaded at runtime from a directory
  (`CP750_MANIFEST_DIR`), so new firmware doesn't need a rebuild. Each file
  must be named `<firmware>.json`. A file with the same firmware as a built-in
  replaces it. Any invalid file fails the whole load, at startup.

## Session: firmware detection and manifest selection (`@cp750/device`)

On every (re)connect:

1. Query `cp750.sysinfo.version ?`. This command is in the normal set.
2. Select a manifest:
   - an exact match with `status: "verified"` gives `match: "exact"` and `verified: true`
   - an exact match that's still a draft gives `match: "exact"` and `verified: false`
   - otherwise, the highest known firmware ≤ the unit's gives `match: "nearest"` and `verified: false`
   - with nothing available: `match: "none"`. Raw passthrough reads only, no writes.
3. Best-effort `help` cross-check (the reply format isn't known yet). Extract
   `cp750.*` tokens. A manifest param missing from `help` is unavailable. A
   `help` name missing from the manifest becomes raw read-only. If `help`
   yields no names, skip the cross-check.
4. When `verified` is false, writes and actions are only allowed for params
   that are in both the manifest **and** the `help` output.

Other rules:

- `full`-tier params require `CP750_ALLOW_FULL=1`. The session then sets
  `cp750.ctrl.full_ascii_ctrl 1` before using them.
- `internal` params are blocked unless `CP750_ALLOW_INTERNAL=1`.
- Writes: validate against the schema, encode, send, read the reply for that
  param, decode, then compare. If the values differ, raise `WriteRejected`
  with the actual value.
- Errors are typed: `NotConnected`, `Timeout`, `UnknownParameter`,
  `WriteRejected`, `InvalidValue`, `Forbidden` (tier/internal/read-only/unverified).
- Access rules live in one place, `packages/device/src/policy.ts`, which both
  the real session and `FakeSession` use:
  - `internal` params (and any `cp750.internal.*` name) are refused for reads
    too, and left out of `commands()`.
  - A param that `help` doesn't list raises `UnknownParameter`, not `Forbidden`.
  - Destructive params need `confirm: true`. The session enforces this itself,
    not just the HTTP layer.
  - An action with no value sends `1`.
  - `sendRaw` only sends read-only lines (`<param> ?`, `help`, `status`,
    `dump_log`, `dump_log_100`). Anything else is `Forbidden`.
- Reconnect with exponential backoff (capped). Poll key params (`fader`,
  `mute`, `input_mode`) at a configurable interval and emit change events.

## Mock CP750 (`@cp750/device`)

A real TCP server driven by a manifest, so tests exercise the real client. It
emulates the manual's semantics: echo on set, the current value on an invalid
value, a blank line for an unknown param, `help`/`status`/`exit`,
full-tier params acting as unknown until `full_ascii_ctrl` is `1` (an
assumption), the 20-session limit, and optional NUL bytes and latency. The
server can run against it with `CP750_MOCK=1` (or `cp750 serve --mock`).

## HTTP API (`@cp750/server`)

Hono with `@hono/zod-openapi`. Errors use RFC 9457 `application/problem+json`.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/device` | connection state, host, firmware, manifest `{firmware,status,match,verified}`, fullControl, readOnly |
| `GET /api/commands` | params of the active manifest (with availability and allowed operations) |
| `GET /api/params/{name}` | read: `{name, value, raw, unit?, db?}`; `name` also accepts aliases, case-insensitively |
| `PUT /api/params/{name}` `{value}` | write + verify. Errors: 400 schema, 403 forbidden, 404 unknown, 422 rejected by device, 503 not connected, 504 timeout |
| `POST /api/actions/{name}` `{value?, confirm?}` | `ctrl.*` actions; destructive ones require `confirm: true` |
| `GET /api/events` | SSE: `param` changes, `connection`, and `device` (firmware/manifest) events |
| `GET /api/openapi.json` | the spec |

Because the value type differs per param, the spec types `value` loosely and
points clients to `GET /api/commands`, which returns each param's JSON Schema
for validation on the client.

Config (env, also CLI flags):

| Variable | Default |
|---|---|
| `CP750_HOST` | `192.168.1.136` |
| `CP750_PORT` | `61408` |
| `LISTEN_HOST` | `127.0.0.1` |
| `PORT` | `2222` |
| `CP750_READ_ONLY` | off |
| `CP750_ALLOW_FULL` | off |
| `CP750_ALLOW_INTERNAL` | off |
| `CP750_API_TOKEN` | unset. If set, mutations require a Bearer token |
| `CP750_EOL` | `\r\n` |
| `CP750_POLL_MS` | — |
| `CP750_MANIFEST_DIR` | — |
| `CP750_MOCK` | off |

## CLI and distribution

- `cp750 serve`: runs the API and serves the built web client, embedded in the
  executable.
- `cp750 capture --host <ip> [--out dir]`: connects, records `version`, `help`
  and `status` as raw text, and writes a draft manifest. This is how new
  firmware gets added.
- `cp750 query <param>`: one-shot read for debugging.
- `bun run compile` builds `dist/cp750-<target>` for linux-x64, windows-x64 and
  darwin-arm64.

## Safety principles

A misfired write during a screening is audible to an audience. So:

- the server is read-only when unsure
- every mutation is an explicit `PUT` or `POST`
- destructive actions need a confirmation
- unverified manifests are restricted
- the server binds to localhost by default.
