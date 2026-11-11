# CP750 REST Interface

A REST + SSE gateway and web client for the Dolby CP750 Digital Cinema Processor. It talks to the
unit over its ASCII TCP protocol (port 61408), uses a typed, per-firmware command registry, and
ships as a single executable.

## Quick start

Requires [Bun](https://bun.sh) (the version in `.bun-version`).

```sh
bun install
bun run check   # lint, typecheck, codegen and OpenAPI staleness checks, tests (what CI runs)
```

Other scripts: `bun run format`, `bun run gen` (regenerate code from the firmware manifests and
the web client's API types), `bun run openapi` (regenerate `openapi/cp750.openapi.json`),
`bun run compile`, `bun run smoke` (smoke-test `dist/cp750-linux-x64`), `bun run test` (all
tests; `bun test` alone skips `apps/web`, see below).

## Run

```sh
bun run dev                                   # API on :2222 (simulated CP750) + web client on :5173
bun run dev:server                            # just the API against the simulated CP750
bun apps/server/src/cli.ts serve              # against the real unit at CP750_HOST
./dist/cp750-linux-x64 serve --mock           # the compiled executable, web client included
```

## Web client

`apps/web` (`@cp750/web`) is the booth operator's UI: Vite, React and TanStack Query, plain CSS
(dark by default for the booth; Light or System under Details), usable from a phone up to a booth
monitor, with the keyboard. Design rules: [`apps/web/DESIGN.md`](apps/web/DESIGN.md).

- **Status bar**: connection and host always visible; read-only and full-control modes when on;
  Details for firmware, the selected manifest (exact/nearest/none, verified or not), modes and
  theme; and the API token when the gateway requires one (kept in `sessionStorage` for the tab). Banners warn when the gateway or the processor is unreachable
  or the manifest is unverified.
- **Controls**: the fader as a big `7.0` readout with dB from the API and where it sits against
  reference (only once confirmed), a slider over a 0–10 scale marking 7.0, ±0.1/±1.0 steps and a
  reset to 7.0; mute; the input. Pending writes say so ("Muting…", "Switching…"). Writes are optimistic and roll back on errors (unless something
  newer arrived meanwhile); a rejected write (`422`) says what the processor kept. Writes to one
  param go one at a time, and mute and input ignore clicks while theirs is pending. Each shows
  **Stale** when live updates have stopped for a few poll intervals.
- **Fader safety**: the step buttons re-read the processor and step from its value, not from the
  display. Dragging sends at most one write per 150 ms, never queues a backlog, and commits the
  final value on release; no single write moves the level more than 1.0 (bigger moves ramp in
  1.0 steps). A click on the track moves one page (1.0) toward the click. The mouse wheel does
  nothing.
- **Advanced**: every param from `/api/commands`, grouped by namespace (the ~310 `cp750.sys.*`
  params by what they do: Fader & mute, Inputs, Decoding, Equalizer per channel with bands low to
  high, Room calibration, Unit & network), with search and a scope:
  Available (default), Locked (refused by the gateway, e.g. the full command set) or All. Each
  control comes from the param's JSON Schema (switch, select, slider + number, number, text); a
  param that can't be changed shows its value as text with a short reason. Values are only read
  for rows on screen, or with Read. Destructive actions need an
  inline second confirmation and send `"confirm": true`.
- **Live**: one `EventSource` on `/api/events` updates the cache, reconnecting with backoff.

In development `bun run dev` runs `cp750 serve --mock` and Vite together; Vite proxies `/api` to
`http://127.0.0.1:2222` (set `CP750_API_URL` to point it elsewhere, e.g. at a server on the real
unit). `bun run compile` builds the client and embeds it in the executable.

The client's API types are generated from `openapi/cp750.openapi.json` into
`apps/web/src/api/generated/` (`bun run gen`; CI fails on drift) and used through `openapi-fetch`.
Its tests run in their own `bun test` process with happy-dom (`apps/web/bunfig.toml`), which is why
the root `bunfig.toml` excludes `apps/web` from a bare `bun test`; `bun run test` runs both.

## Configuration

Environment variables, or the matching flag (flags win). Booleans take `1/0`, `true/false`,
`yes/no` or `on/off`. Invalid values stop the server with a message naming each bad setting.

| Variable | Flag | Default | Meaning |
|---|---|---|---|
| `CP750_HOST` | `--cp750-host`, `--host` | `192.168.1.136` | processor address |
| `CP750_PORT` | `--cp750-port` | `61408` | processor TCP port |
| `CP750_LISTEN_HOST` | `--listen-host` | `127.0.0.1` | HTTP bind address |
| `CP750_LISTEN_PORT` | `--port` | `2222` | HTTP port (`0` picks a free one) |
| `CP750_READ_ONLY` | `--read-only` | off | refuse every write and action |
| `CP750_ALLOW_FULL` | `--allow-full` | off | allow `full`-tier params |
| `CP750_ALLOW_INTERNAL` | `--allow-internal` | off | allow `internal` params |
| `CP750_API_TOKEN` | (env only) | unset | if set, PUT/POST need `Authorization: Bearer <token>`; at least 16 characters |
| `CP750_EOL` | `--eol` | `crlf` | command terminator: `crlf`, `lf` or `cr` |
| `CP750_POLL_MS` | `--poll-ms` | `1000` | poll fader/mute/input every N ms so front-panel changes show up; `0` turns it off |
| `CP750_MANIFEST_DIR` | `--manifest-dir` | none | extra `<firmware>.json` manifests |
| `CP750_MOCK` | `--mock` | off | run against a built-in mock CP750 (a local TCP server) |
| `CP750_CORS_ORIGIN` | `--cors-origin` | none | comma-separated origins allowed cross-origin |
| `CP750_ALLOWED_HOSTS` | `--allowed-hosts` | none | extra `Host` names to answer, e.g. `booth-pc.local` (see Security) |
| `CP750_MAX_SSE_CLIENTS` | `--max-sse-clients` | `32` | concurrent `/api/events` streams |

Every variable starts with `CP750_`, and an unknown `CP750_*` variable (a typo such as
`CP750_READONLY`) is reported as a warning at startup. The compiled executable does **not** read
`.env` files: set variables in the environment (shell, systemd unit, service manager).

## HTTP API

| Method and path | Purpose |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/device` | connection, firmware, selected manifest, mode flags |
| `GET /api/commands` | the active firmware's params, each with its value JSON Schema and allowed operations |
| `GET /api/params/{name}` | read: `{name, value, raw, unit?, db?}` (`db` for faders) |
| `PUT /api/params/{name}` `{value, confirm?}` | write, then verify the unit's echo |
| `POST /api/actions/{name}` `{value?, confirm?}` | trigger a `cp750.ctrl.*` action |
| `GET /api/events` | SSE: `connection` and `device` snapshots, then `param`, `connection`, `device` events |
| `GET /api/openapi.json` | the OpenAPI 3.1 document (also committed as `openapi/cp750.openapi.json`) |

Names accept aliases and any case. `PUT` and `POST` must send `Content-Type: application/json`,
even an action without a body (an empty body counts as `{}`). Errors are RFC 9457
`application/problem+json` with a stable `code`: `400 INVALID_VALUE`/`BAD_REQUEST`,
`401 UNAUTHORIZED`, `403 FORBIDDEN` (with `reason`)/`ORIGIN_NOT_ALLOWED`,
`404 UNKNOWN_PARAMETER`/`NOT_FOUND`, `405 METHOD_NOT_ALLOWED`, `413 PAYLOAD_TOO_LARGE`,
`415 UNSUPPORTED_MEDIA_TYPE`, `421 HOST_NOT_ALLOWED`, `422 WRITE_REJECTED` (with `requested` and
`actual`), `503 NOT_CONNECTED`/`TOO_MANY_STREAMS`, `504 TIMEOUT`.

```sh
curl localhost:2222/api/params/cp750.sys.fader
curl -X PUT localhost:2222/api/params/cp750.sys.fader -H 'content-type: application/json' -d '{"value":70}'
curl -X POST localhost:2222/api/actions/cp750.ctrl.reboot -H 'content-type: application/json' -d '{"confirm":true}'
curl -X POST localhost:2222/api/actions/cp750.ctrl.fader_delta -H 'content-type: application/json'
```

## CLI

```
cp750 serve [--mock] [options]           run the HTTP API and the embedded web client
cp750 capture --host <ip> [--out <dir>]  record version, help and status (normal and full set)
                                         into <dir>/<firmware>/*.txt and a draft manifest
                                         <dir>/<firmware>.json
cp750 query <param> [options]            read one parameter, print it as JSON
cp750 --help | --version
```

To support a new firmware, capture a unit running it and follow
[docs/ADDING-A-FIRMWARE.md](docs/ADDING-A-FIRMWARE.md): review the draft, check in the capture,
and decide between `draft` and `verified`. The capture directory works as `CP750_MANIFEST_DIR`
right away.

## Compiling

`bun run compile` builds `apps/web` (when present), embeds its `dist/` into the executable, and
writes `dist/cp750-linux-x64`, `dist/cp750-windows-x64.exe` and `dist/cp750-darwin-arm64`
(`--target linux-x64` builds just one). Each is a single ~90–115 MB file with no runtime
dependencies, built with `.env` and `bunfig.toml` autoloading off. CI compiles all three and runs
`scripts/smoke-test.sh` against the Linux one.

The web build is embedded through `apps/server/src/generated/web-assets.ts`, a generated module
of `import … with { type: "file" }` statements: `bun build --compile` bundles those files and
resolves them to `/$bunfs/…` paths that `Bun.file` reads. The committed module is empty; the
compile script fills it from `apps/web/dist` and restores it afterwards. To serve a local web build
from source, run `bun apps/server/scripts/web-assets.ts` (and `--empty` to reset it).

## Safety and security

A misfired write during a screening is audible, and a hostile web page open in the operator's
browser can reach a server on localhost. So:

- the server binds to `127.0.0.1` unless told otherwise, and warns when it listens on the network
  without `CP750_API_TOKEN`
- it only answers requests whose `Host` is `localhost`, `127.0.0.1`, `[::1]`, the listen address
  or one of `CP750_ALLOWED_HOSTS` (any port); anything else gets `421`. This stops DNS rebinding,
  where a page re-points its own domain at 127.0.0.1. When listening on `0.0.0.0` the machine's
  own IP addresses are allowed too; add a hostname such as `booth-pc.local` to
  `CP750_ALLOWED_HOSTS` to use it
- `PUT`/`POST` from another site (a foreign `Origin`, or `Sec-Fetch-Site: cross-site`) are refused
  with `403` unless the origin is in `CP750_CORS_ORIGIN`, and every `PUT`/`POST` must be
  `application/json` (`415` otherwise), which a page cannot send cross-site without a CORS
  preflight
- request bodies are limited to 4 KiB, event streams to `CP750_MAX_SSE_CLIENTS`
- reads are always open; every change is an explicit `PUT` or `POST`, gated by the token when set
- `CP750_READ_ONLY=1` refuses all changes, in the HTTP layer and in the session
- destructive actions (`reboot`, `default_params`, `log_erase`…) need `"confirm": true`
- unverified (draft or nearest-match) manifests only allow writes to params the unit's `help` lists.
  Both built-in manifests are drafts (transcribed from Dolby's manual, not yet checked against a
  real unit), so if a unit's `help` output can't be parsed, the gateway stays read-only. Run
  `cp750 capture` against your unit and follow [docs/ADDING-A-FIRMWARE.md](docs/ADDING-A-FIRMWARE.md)
  to get a verified manifest
- `full`-tier and `internal` params stay off unless explicitly allowed
- pass the token through the environment, never a flag (argv is visible in `ps`); it is never
  logged

## Layout

| Path | Package |
|---|---|
| `packages/manifests` | `@cp750/manifests`: meta-schema, firmware manifests, loader, value codec, generated types |
| `packages/device` | `@cp750/device`: TCP client, session (firmware detection, manifest selection), mock CP750, capture |
| `apps/server` | `@cp750/server`: Hono HTTP API, OpenAPI generation, SSE, config, `cp750` CLI |
| `apps/web` | `@cp750/web`: the web client (Vite, React, TanStack Query) |
| `openapi/cp750.openapi.json` | generated OpenAPI 3.1 spec (CI fails on drift) |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and the device protocol.

## License

[MIT](LICENSE)
