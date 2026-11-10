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
- `packages/manifests/captures/<firmware>/`: the raw capture a `verified` manifest is checked
  against (see [ADDING-A-FIRMWARE.md](ADDING-A-FIRMWARE.md)).

Manifest shape (top level):

```jsonc
{
  "$schema": "../schema/cp750-manifest.v1.schema.json",
  "manifestVersion": 1,
  "firmware": "1.0.0.150183",
  "status": "verified" | "draft",          // verified = cross-checked against a checked-in capture
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
treats it as an annotation only. The meta-schema also requires at least one
entry in `commands`, and allows `destructive: true` only with `access: "action"`.
Param names are exactly three segments, `cp750.<category>.<parameter>`: the
device layer's `help` parsing and raw-read checks assume that shape. Beyond the
meta-schema, the loader also rejects value schemas that don't compile,
`minimum > maximum`, integer `enum` members outside `minimum`/`maximum`, a
`unit` on a non-integer value, a non-action `destructive` param, a
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
  replaces it. Any invalid file fails the whole load, at startup. Non-JSON
  files are ignored, so a `cp750 capture --out` directory works as-is.
- **Draft → verified.** A manifest may only be `verified` when its capture is
  checked in under `captures/<firmware>/`, `sources` names it
  (`{"kind":"capture","ref":"captures/<firmware>/"}`), and every manifest param
  is in that capture's `help` (normal or full) and vice versa. A test enforces
  this; 1.0.0.150183 predates the rule and is grandfathered until it is demoted.

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

Implementation choices (`createCp750Session`, `Cp750Client`):

- **One queue.** Detection, API calls and polls all go through one FIFO
  queue on one socket, with one request in flight. Lines are split on CR, LF
  or CRLF (also when CRLF straddles two TCP chunks), and NULs are dropped.
- **Reply matching.** The reply to `<param> ?` or `<param> <value>` is the
  first line whose first token equals the param, compared case-insensitively.
  A `param : value` form is accepted too. Other lines (the 21st-session
  warning, unsolicited text) are ignored.
- **Blank lines.** A blank line before the match means `UnknownParameter`,
  but only after a **grace window** (`timeouts.blankGraceMs`, default 50 ms)
  with no matching line. A unit that treats CR and LF as two terminators
  answers the LF of `\r\n` with a stray blank line, which can arrive just
  before the next reply. That costs a genuinely unknown param 50 ms.
- **Multi-line commands** (`help`, `status`, `dump_log*`): `commandMs` covers
  the first line. After that, the reply ends after `idleMs` of silence
  (default 300 ms), capped at `multiLineMaxMs` (10 s) and 10 000 lines.
  Leading and trailing blank lines are dropped.
- **Timeouts.** The caller gets `Timeout` after `commandMs` (default 2 s),
  but the queue is held ("quarantine") until the late reply arrives (a
  matching or blank line) or 3 × `commandMs` passes. The unit answers in
  order, so this keeps a late echo from being taken as the reply to the next
  command, which could otherwise cause a false `WriteRejected`. A timeout
  does not drop the connection.
- **Detection.** On every (re)connect: version, then `selectManifest`. Then,
  with `allowFull`, `cp750.ctrl.full_ascii_ctrl 1` **before** `help`, so
  `help` can vouch for full-tier params. Then `help`, then the `device` event,
  then the `connection: connected` event. When `help` ran without full
  control, a full-tier param it didn't list is `unchecked`, not `missing`
  (`AccessPolicy.helpCoversFull`). So with `allowFull` off it is `Forbidden`
  (`full-tier`), not `UnknownParameter`.
- **Full control** is per connection on the unit. It is re-enabled on every
  reconnect, and lazily before a full-tier call if it was turned off. Turning
  it on is allowed in read-only mode, since it changes no audio.
- **Writes** emit a `param` event for the echoed value, including on
  `WriteRejected`. Actions are not recorded as param values.
- **Polling** runs the first poll right after connecting, then waits
  `pollIntervalMs` after each pass finishes. It never overlaps itself. Params
  the policy refuses (e.g. `mute` on 1.0.0.150183 without `allowFull`) are
  skipped and logged once per detection through `SessionOptions.logger`.
  Failed polls are logged at debug level and never end the session.
- **Reconnect** backoff starts at 500 ms and doubles up to 30 s. It resets
  after a successful connect. An invalid `manifestDir` is fatal: `connect()`
  rejects and the session closes.
- `close()` fails pending calls with `NotConnected`, sends `exit`, and waits
  up to 500 ms for the unit to close the socket.
- **Capture** (`captureDevice`) reads the version, then `help` and `status`
  with the normal set, then again with `full_ascii_ctrl 1` (and sets it back
  to 0), then sends `exit`. The draft manifest takes specs from the nearest
  built-in: an exact match, else the nearest lower firmware, else the oldest.
  If the full-set pass revealed names the normal pass didn't, tiers are taken
  from what was observed. Otherwise the base tiers are kept.

## Mock CP750 (`@cp750/device`)

A real TCP server driven by a manifest, so tests exercise the real client. It
emulates the manual's semantics: echo on set, the current value on an invalid
value, a blank line for an unknown param, `help`/`status`/`exit`,
full-tier params acting as unknown until `full_ascii_ctrl` is `1` (an
assumption), the 20-session limit, and optional NUL bytes and latency. The
server can run against it with `CP750_MOCK=1` (or `cp750 serve --mock`).

It is `startMockCp750` from `@cp750/device/mock`. Its choices:

- Values are shared by all connections (one unit). **Full control is per
  connection**, as the manual says "for this session", so every new session
  starts with the normal set.
- Defaults: the first enum member, else 0 if the range allows it, else the
  minimum. Strings default to `""`. `cp750.sysinfo.version` is the manifest's
  firmware unless `initial` overrides it, which is how tests fake a nearest
  or unknown firmware.
- Sets on `readonly` params and invalid values are ignored, and the current
  value is echoed.
- `help` prints a header, one indented `name  values` line per param visible
  at the connection's tier, the single-word commands, and a blank line. That
  format is invented, and clients only extract `cp750.*` tokens. `status`
  prints `param : value` lines (no actions) and a blank line.
- The 21st connection makes the mock write a warning line to the oldest
  session and close it `evictionDelayMs` later (default 50 ms).
- Replies on one connection are serialized and delayed by `latencyMs`, which
  can be changed while the mock is running.
- Test knobs: `nulBytes`, `fragmented` (each reply's CRLF is split across two
  writes), `blankForEmptyLines` (CR and LF count as separate terminators, and
  empty lines get a blank reply), `received` (the command log),
  `dropConnections()`.

## HTTP API (`@cp750/server`)

Hono with `@hono/zod-openapi`. Errors use RFC 9457 `application/problem+json`.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/device` | connection state, host, firmware, manifest `{firmware,status,match,verified}`, fullControl, readOnly |
| `GET /api/commands` | params of the active manifest (with availability and allowed operations) |
| `GET /api/params/{name}` | read: `{name, value, raw, unit?, db?}`; `name` also accepts aliases, case-insensitively |
| `PUT /api/params/{name}` `{value}` | write + verify. Errors: 400 schema, 403 forbidden, 404 unknown, 413 too large, 415 not JSON, 422 rejected by device, 503 not connected, 504 timeout |
| `POST /api/actions/{name}` `{value?, confirm?}` | `ctrl.*` actions; destructive ones require `confirm: true`. JSON even without a body (`{}` when empty) |
| `GET /api/events` | SSE: `param` changes, `connection`, and `device` (firmware/manifest) events. Capped; `HEAD` opens no stream |
| `GET /api/openapi.json` | the spec |

Because the value type differs per param, the spec types `value` loosely and
points clients to `GET /api/commands`, which returns each param's JSON Schema
for validation on the client. The `{name}` path parameter is a plain string
for the same reason.

Details of the implementation:

- Problem `type`s are `urn:cp750:problem:<code>` and every body carries the
  stable `code`: `INVALID_VALUE`/`BAD_REQUEST` 400, `UNAUTHORIZED` 401,
  `FORBIDDEN` (with `reason`)/`ORIGIN_NOT_ALLOWED` 403,
  `UNKNOWN_PARAMETER`/`NOT_FOUND` 404, `METHOD_NOT_ALLOWED` 405 (with `Allow`),
  `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `HOST_NOT_ALLOWED` 421,
  `WRITE_REJECTED` 422 (with `requested`, `actual`, `raw`), `INTERNAL` 500,
  `NOT_CONNECTED`/`TOO_MANY_STREAMS` 503, `TIMEOUT` 504.
- With `CP750_API_TOKEN` set, every non-GET/HEAD/OPTIONS request under `/api`
  needs `Authorization: Bearer <token>` (compared in constant time) or gets
  401. Reads stay open. The token is env-only: no CLI flag, never logged, and
  at least 16 characters.
- The HTTP layer repeats session rules before calling it, in the session's
  order: read-only mode (403 `read-only-mode`), then the operation's own
  refusal from the command list (`access`, `full-tier`, `unverified`…; so
  `PUT` on an action is `access`), then the destructive confirmation (403
  `confirmation-required`).
- `GET /api/events` starts with a `connection` and a `device` snapshot, then
  forwards session events. The SSE `event` is the type, `data` is the JSON
  event, and `: ping` comments are sent every 15 s. At most
  `CP750_MAX_SSE_CLIENTS` (32) streams are open at once; more get 503
  `TOO_MANY_STREAMS`. A client with 100 unsent messages (it stopped reading)
  is dropped. `HEAD` answers the headers without subscribing (Hono would
  otherwise run the GET handler and leak the stream).
- The request log prints the method, the raw (percent-encoded) path with
  control characters escaped, the status and the duration.
- `secureHeaders` with a same-origin CSP. CORS is off unless
  `CP750_CORS_ORIGIN` lists origins.

### Security model

The threat to design for is a hostile web page open in the operator's browser
while the gateway listens on 127.0.0.1. The browser can reach localhost, and a
wrong write is audible in the auditorium. There are no cookies, so classic
CSRF does not apply, but two browser tricks do. Every request passes these
checks (`apps/server/src/guards.ts`) before routing:

1. **Host allow-list (DNS rebinding).** A page on `evil.example` can rebind its
   name to 127.0.0.1 and then read and write "same-origin". The browser still
   sends `Host: evil.example`, so any `Host` not in the list gets 421
   `HOST_NOT_ALLOWED`: `localhost`, `127.0.0.1`, `[::1]`, the listen host and
   `CP750_ALLOWED_HOSTS`, each with any port. When listening on `0.0.0.0`/`::`
   the machine's interface addresses are added too, since an IP literal cannot
   be rebound. This covers every path, so the event stream and the web client
   are refused too.
2. **No cross-site mutations.** `PUT`/`POST` are refused with 403
   `ORIGIN_NOT_ALLOWED` when `Sec-Fetch-Site: cross-site`, or when an `Origin`
   header is present and is neither this server (its host equals `Host`) nor
   listed in `CP750_CORS_ORIGIN`. Requests without either header (curl,
   scripts) pass; the token still applies to them.
3. **JSON only.** `PUT`/`POST` need `Content-Type: application/json`, even a
   body-less action, or get 415. A cross-site page can only send a "simple
   request" without a CORS preflight (form encodings, `text/plain`, or no
   body), so this keeps out even a browser that sends no `Origin` or
   `Sec-Fetch-Site`. An empty JSON action body counts as `{}`.
4. **Size limits.** Bodies are limited to 4 KiB (`Bun.serve`
   `maxRequestBodySize` and the app), string values to 256 characters and
   names to 128.

CORS (`CP750_CORS_ORIGIN`) only decides which other origins may *read*
responses and send preflighted requests; `*` without a token draws a startup
warning. The compiled executable reads its config from the real environment
only (built with `--no-compile-autoload-dotenv`), and unknown `CP750_*`
variables draw a warning, so a typo such as `CP750_READONLY` is not silently
ignored.
- Non-`/api` GETs serve the embedded web client: exact files, `index.html` for
  extension-less paths (SPA routes), 404 for other missing files, and a short
  HTML notice when the build has no web client.

Config (env, also CLI flags):

| Variable | Default |
|---|---|
| `CP750_HOST` | `192.168.1.136` |
| `CP750_PORT` | `61408` |
| `CP750_LISTEN_HOST` | `127.0.0.1` |
| `CP750_LISTEN_PORT` | `2222` |
| `CP750_READ_ONLY` | off |
| `CP750_ALLOW_FULL` | off |
| `CP750_ALLOW_INTERNAL` | off |
| `CP750_API_TOKEN` | unset. If set (16+ characters), mutations require a Bearer token |
| `CP750_EOL` | `\r\n` |
| `CP750_POLL_MS` | `1000`; `0` turns polling off |
| `CP750_MANIFEST_DIR` | — |
| `CP750_MOCK` | off |
| `CP750_CORS_ORIGIN` | unset. Comma-separated origins allowed cross-origin |
| `CP750_ALLOWED_HOSTS` | unset. Extra comma-separated `Host` names to answer |
| `CP750_MAX_SSE_CLIENTS` | `32` |

Each variable has a flag (`--cp750-host`/`--host`, `--cp750-port`,
`--listen-host`, `--port`, `--read-only`, `--allow-full`, `--allow-internal`,
`--eol crlf|lf|cr`, `--poll-ms`, `--manifest-dir`, `--mock`, `--cors-origin`,
`--allowed-hosts`, `--max-sse-clients`) that overrides it, except
`CP750_API_TOKEN`. Every variable is `CP750_`-prefixed so the gateway never
picks up another program's `PORT`. `GET /api/device` reports `pollMs`.

## CLI and distribution

- `cp750 serve`: runs the API and serves the built web client, embedded in the
  executable.
- `cp750 capture --host <ip> [--out dir]`: connects, records the version line,
  `help` and `status` (normal and full set) as raw text under
  `<dir>/<firmware>/`, and writes the draft manifest as `<dir>/<firmware>.json`,
  so `<dir>` works as `CP750_MANIFEST_DIR`. This is how new firmware gets
  added; see [ADDING-A-FIRMWARE.md](ADDING-A-FIRMWARE.md).
- `cp750 query <param>`: one-shot read for debugging; prints the reading as
  JSON (`{name, value, raw, unit?, db?}`).
- `bun run compile` builds `dist/cp750-<target>` for linux-x64, windows-x64 and
  darwin-arm64, with `.env` and `bunfig.toml` autoloading off. CI compiles all
  three and runs `scripts/smoke-test.sh` against the Linux one.
- Session construction lives only in `apps/server/src/session-factory.ts`.
- The web build is embedded through `apps/server/src/generated/web-assets.ts`,
  generated from `apps/web/dist` as `import … with { type: "file" }`
  statements. `bun build --compile` embeds those files and resolves them to
  `/$bunfs/…` paths. The committed module is empty; `bun run compile` fills it
  and restores it.

## Web client (`@cp750/web`)

- Vite + React + TanStack Query, plain CSS modules over a token sheet (`src/styles/tokens.css`),
  light/dark via `prefers-color-scheme`. Vite runs under Bun (`bun --bun vite`). No router: two
  views (Controls, Advanced) as ARIA tabs kept in the URL hash.
- **API types** are generated from `openapi/cp750.openapi.json` by openapi-typescript into
  `src/api/generated/schema.ts` (committed, `gen:check` in CI) and called through `openapi-fetch`.
  openapi-typescript needs the TypeScript 5 compiler API, so `apps/web` has `typescript@5.9` as a
  dev dependency for codegen only; its `typecheck` script runs the repo's TypeScript 7.
- Every error is an `ApiError` carrying the problem details (plus a client-side `NETWORK` code), and
  is shown as title/detail/code, never raw JSON.
- **Cache keys**: `["device"]`, `["commands"]`, `["param", name]`. One `EventSource` on
  `/api/events` writes `param` events into `["param", name]` and patches `["device"]` on
  `connection`/`device` events (and refetches the command list) when they differ from the cache;
  the matching snapshots a stream opens with change nothing. Param events carry no dB, so a
  changed fader value drops its stale `db` and re-reads. The client owns reconnection
  (exponential backoff 1 s → 30 s) and invalidates what it may have missed after a reopen.
- **Writes** are optimistic. Writes to one param run one at a time, in order (mutation
  `scope`). A failure rolls back, or takes `actual` on `WRITE_REJECTED`, only while the cache
  still holds that write's optimistic value; if something newer replaced it, the param is
  re-read instead. A `param` event for a param with a write pending is held back; when the last
  write settles, a held value that disagrees with the cache triggers a re-read (the write's own
  echo does not). Mutations never retry. Mute, input and switch controls are `aria-disabled`
  while their write is pending (they keep focus), so a double click sends one write.
- **Fader safety.** The slider sends through a "latest value" sender: one request in flight,
  newer values replace the waiting one, at most one send per 150 ms, flushed on release. Each send
  moves at most 1.0 (10 raw) from the last known level; a bigger target (Home/End, a fast drag,
  return to 7.0 from far away) is reached in 1.0 steps. A pointer gesture that starts on the
  track moves one page (±1.0) toward the click, not to it. Wheel events are cancelled. The ±0.1
  and ±1.0 buttons first re-read `cp750.sys.fader` and step from the processor's value, one click
  at a time.
- **Staleness.** Fader, mute and input show "Stale" when their value may no longer match the
  unit: no confirmation for 3 poll intervals (at least 3 s; 10 s with polling off). The value
  counts as confirmed while the event stream is open, the processor connected and the gateway
  polling (`pollMs` from `/api/device`), since every front-panel change then arrives within one
  interval.
- **Disabled controls** carry a reason: the command's `blocked` reason from `/api/commands`, then
  read-only mode, a disconnected processor, or a missing token when `authRequired`.
- **Advanced** reads lazily: groups are collapsed by default, rows read once they have been on
  screen for 300 ms (IntersectionObserver), or on demand. Destructive actions use an inline
  two-step confirmation that sends `confirm: true`; however it closes (Yes, Cancel, Escape,
  expiry), focus returns to the trigger. Each row's Set, Undo and Read buttons are named after
  the param ("Set cp750.sys.mute_fade_in_time").
- Code layout: named exports only; components colocated recursively
  (`components/X/X.tsx`, `components/X/components/Y/Y.tsx`) with their CSS modules and tests.
- Tests run in a separate `bun test` process (`apps/web/bunfig.toml` preloads happy-dom and a CSS
  module stub); the root `bunfig.toml` ignores `apps/web` so DOM globals never reach server tests.

## Safety principles

A misfired write during a screening is audible to an audience. So:

- the server is read-only when unsure
- every mutation is an explicit `PUT` or `POST`
- destructive actions need a confirmation
- unverified manifests are restricted
- the server binds to localhost by default, and refuses foreign `Host`s, cross-site and
  non-JSON mutations (see "Security model")
- the UI never steps from a stale display, and no single fader send moves more than 1.0.
