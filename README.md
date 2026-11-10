# CP750 REST Interface

A REST + SSE gateway and web client for the Dolby CP750 Digital Cinema Processor. It talks to the
unit over its ASCII TCP protocol (port 61408), uses a typed, per-firmware command registry, and
ships as a single executable.

> Work in progress: the manifests package and the device contracts exist; the TCP client, HTTP API
> and web client are being built.

## Quick start

Requires [Bun](https://bun.sh) (the version in `.bun-version`).

```sh
bun install
bun run check   # lint, typecheck, codegen staleness check, tests (what CI runs)
```

Other scripts: `bun run format`, `bun run gen` (regenerate code from the firmware manifests),
`bun test`.

## Layout

| Path | Package |
|---|---|
| `packages/manifests` | `@cp750/manifests`: meta-schema, firmware manifests, loader, value codec, generated types |
| `packages/device` | `@cp750/device`: session contracts (TCP client, session and mock to follow) |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and the device protocol.

## License

[MIT](LICENSE)
