/**
 * Request guards that run before routing (docs/ARCHITECTURE.md, "Security model"). The gateway
 * listens on localhost and has no session cookies, so the browser threats are a hostile page in the
 * operator's browser reaching it through DNS rebinding (a foreign `Host`) or a cross-site "simple
 * request" (a form-style POST that needs no CORS preflight).
 */
import { networkInterfaces } from "node:os";
import type { MiddlewareHandler } from "hono";
import { isWildcardAddress, normalizeHostname, type ServerConfig } from "./config.ts";
import { problem, problemResponse } from "./problem.ts";

/** Largest request body the API accepts. Mutation bodies are a few dozen bytes. */
export const MAX_BODY_BYTES = 4 * 1024;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Splits a `Host` header into its normalized hostname; `null` if it is malformed. */
export function hostFromHeader(value: string): string | null {
  const host = value.trim();
  let name = host;
  let port = "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end < 0) return null;
    name = host.slice(0, end + 1);
    port = host.slice(end + 1);
  } else {
    const colon = host.lastIndexOf(":");
    if (colon >= 0) {
      name = host.slice(0, colon);
      port = host.slice(colon);
    }
  }
  if (port !== "" && !/^:\d{1,5}$/.test(port)) return null;
  return normalizeHostname(name);
}

/** Addresses of this machine's interfaces, as `Host` names (IPv6 in brackets). */
function interfaceHosts(): string[] {
  const hosts: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      const name = normalizeHostname(a.address.split("%")[0] as string);
      if (name) hosts.push(name);
    }
  }
  return hosts;
}

/**
 * The `Host` names the server answers to (any port): localhost, 127.0.0.1, [::1], the listen host,
 * and `CP750_ALLOWED_HOSTS`. When it listens on every interface (`0.0.0.0`, `::`), the IP
 * addresses of this machine's interfaces too: an IP literal cannot be rebound.
 */
export function allowedHostNames(
  config: Pick<ServerConfig, "listenHost" | "allowedHosts">,
  interfaces: () => string[] = interfaceHosts,
): Set<string> {
  const names = new Set(["localhost", "127.0.0.1", "[::1]", ...config.allowedHosts]);
  if (isWildcardAddress(config.listenHost)) {
    for (const host of interfaces()) names.add(host);
  } else {
    const listen = normalizeHostname(config.listenHost);
    if (listen) names.add(listen);
  }
  return names;
}

/** The request's `Host`: the header, or the URL's host when there is none (in-process requests). */
function requestHost(raw: Request): string {
  return raw.headers.get("host") ?? new URL(raw.url).host;
}

/** Answers 421 to any `Host` not in `allowed`, for every path (API, SSE and the web client). */
export function hostGuard(allowed: ReadonlySet<string>): MiddlewareHandler {
  return async (c, next) => {
    const header = requestHost(c.req.raw);
    const host = hostFromHeader(header);
    if (host === null || !allowed.has(host)) {
      return problemResponse(
        problem(
          "HOST_NOT_ALLOWED",
          "This server does not answer to that Host; add it to CP750_ALLOWED_HOSTS if it is yours",
          { instance: c.req.path },
        ),
      );
    }
    return next();
  };
}

/**
 * Refuses cross-site mutations: a non-safe request whose `Origin` is neither this server's nor in
 * the CORS allow-list, or that the browser marks `Sec-Fetch-Site: cross-site`. Requests without
 * either header (curl, scripts) pass; the token, when set, still applies.
 */
export function originGuard(corsOrigins: readonly string[]): MiddlewareHandler {
  const anyOrigin = corsOrigins.includes("*");
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const origin = c.req.header("origin");
    if (origin !== undefined && (anyOrigin || corsOrigins.includes(origin))) return next();
    const crossSite = c.req.header("sec-fetch-site")?.toLowerCase() === "cross-site";
    if (crossSite || (origin !== undefined && !sameOrigin(origin, requestHost(c.req.raw)))) {
      return problemResponse(
        problem(
          "ORIGIN_NOT_ALLOWED",
          "Cross-origin changes are refused; list the origin in CP750_CORS_ORIGIN to allow it",
          { instance: c.req.path },
        ),
      );
    }
    return next();
  };
}

function sameOrigin(origin: string, host: string): boolean {
  try {
    const url = new URL(origin);
    return /^https?:$/.test(url.protocol) && url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false; // includes the opaque origin "null"
  }
}

/**
 * For `PUT`/`POST` API routes: the body must be `application/json` (so a cross-site page cannot
 * send a preflight-free "simple request"), at most `MAX_BODY_BYTES`, and an empty body on an
 * action counts as `{}`.
 */
export function jsonBodyGuard(options: {
  method: "PUT" | "POST";
  emptyBodyIsObject: boolean;
}): MiddlewareHandler {
  return async (c, next) => {
    // Other methods fall through to routing (405).
    if (c.req.method !== options.method) return next();
    const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") {
      return problemResponse(
        problem(
          "UNSUPPORTED_MEDIA_TYPE",
          "Send the request with Content-Type: application/json (even without a body)",
          { instance: c.req.path },
        ),
        { accept: "application/json" },
      );
    }
    const length = Number(c.req.header("content-length") ?? "0");
    const tooLarge = () =>
      problemResponse(
        problem("PAYLOAD_TOO_LARGE", `The request body is limited to ${MAX_BODY_BYTES} bytes`, {
          instance: c.req.path,
        }),
      );
    if (length > MAX_BODY_BYTES) return tooLarge();
    const text = await c.req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return tooLarge();
    if (options.emptyBodyIsObject && text.trim() === "") {
      // `c.req.json()` parses the cached text, so an empty action body reads as `{}`.
      // (Hono stores the pending body promise there; its type says `string`.)
      (c.req.bodyCache as { text?: Promise<string> }).text = Promise.resolve("{}");
    }
    return next();
  };
}
