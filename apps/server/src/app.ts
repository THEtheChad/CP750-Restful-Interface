/**
 * The HTTP API (docs/ARCHITECTURE.md, "HTTP API"): a Hono app over a `Cp750Session`. All access
 * rules are enforced by the session; the HTTP layer adds auth, read-only mode and the destructive
 * confirmation as a second line of defence, and maps device errors to problem+json.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { type CommandInfo, type Cp750Session, Forbidden, type SessionEvent } from "@cp750/device";
import { normalizeParamName, type ValueSchema } from "@cp750/manifests";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import pkg from "../package.json" with { type: "json" };
import type { ServerConfig } from "./config.ts";
import { sortKeys } from "./json.ts";
import {
  type Problem,
  type ProblemCode,
  problem,
  problemFromError,
  problemResponse,
} from "./problem.ts";
import { findCommand, toReading } from "./reading.ts";
import {
  actionRoute,
  commandsRoute,
  deviceRoute,
  eventsRoute,
  healthRoute,
  openApiRoute,
  readParamRoute,
  TAGS,
  writeParamRoute,
} from "./routes.ts";
import { serveWeb, type WebAssets } from "./web.ts";

export const SERVER_VERSION: string = pkg.version;

export interface CreateAppOptions {
  session: Cp750Session;
  config: ServerConfig;
  /** The embedded web client (see `generated/web-assets.ts`). Default: none, which shows a notice. */
  webAssets?: WebAssets;
  /** Receives one line per request and unexpected errors. Default: no logging. */
  log?: (line: string) => void;
  /** SSE heartbeat interval. Default 15 s. */
  heartbeatMs?: number;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Compares two secrets in constant time (hashing first, so length differences don't leak either). */
export function tokensEqual(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

/** A mutable copy of a value schema (the manifest's arrays are readonly). */
function valueSchema(schema: ValueSchema) {
  const { enum: values, ...rest } = schema;
  return { ...rest, ...(values ? { enum: [...values] } : {}) };
}

function toCommand(c: CommandInfo) {
  const spec = c.spec;
  return {
    name: c.name,
    aliases: [...(spec?.aliases ?? [])],
    source: c.source,
    availability: c.availability,
    operations: [...c.operations],
    blocked: { ...c.blocked },
    access: spec?.access ?? null,
    tier: spec?.tier ?? null,
    unit: spec?.unit ?? null,
    destructive: spec?.destructive === true,
    internal: spec?.internal === true,
    description: spec?.description ?? null,
    schema: spec ? valueSchema(spec.value) : null,
  };
}

function httpProblem(error: HTTPException): Problem {
  const codes: Record<number, ProblemCode> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
  };
  const code = codes[error.status] ?? (error.status < 500 ? "BAD_REQUEST" : "INTERNAL");
  return problem(code, error.message || "Request failed");
}

/** Logs method, path (no query string), status and duration. Never headers or bodies. */
function requestLogger(log: (line: string) => void): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const ms = (performance.now() - start).toFixed(1);
    log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
  };
}

function bearerAuth(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
    if (!match) {
      return problemResponse(
        problem("UNAUTHORIZED", "This server requires a Bearer token for changes", {
          instance: c.req.path,
        }),
        { "www-authenticate": 'Bearer realm="cp750"' },
      );
    }
    if (!tokensEqual(match[1] as string, token)) {
      return problemResponse(problem("UNAUTHORIZED", "Invalid token", { instance: c.req.path }), {
        "www-authenticate": 'Bearer realm="cp750", error="invalid_token"',
      });
    }
    return next();
  };
}

/**
 * Builds the API. The app is independent of how the session was made (real, mock or fake), so
 * tests run it in-process with `app.request()`.
 */
export function createApp(options: CreateAppOptions) {
  const { session, config, webAssets = {}, log, heartbeatMs = 15_000 } = options;

  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (result.success) return;
      const errors = result.error.issues.map(
        (i) => `${[result.target, ...i.path].join(".")}: ${i.message}`,
      );
      return problemResponse(
        problem("BAD_REQUEST", "Request validation failed", { errors, instance: c.req.path }),
      );
    },
  });

  app.use(
    "*",
    secureHeaders({
      // Served over plain HTTP on a booth LAN; HSTS would only get in the way of a later proxy setup.
      strictTransportSecurity: false,
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );
  if (log) app.use("*", requestLogger(log));
  if (config.corsOrigins.length > 0) {
    app.use(
      "/api/*",
      cors({
        origin: config.corsOrigins.includes("*") ? "*" : [...config.corsOrigins],
        allowMethods: ["GET", "PUT", "POST", "OPTIONS"],
        allowHeaders: ["Authorization", "Content-Type"],
        maxAge: 600,
      }),
    );
  }
  if (config.apiToken) app.use("/api/*", bearerAuth(config.apiToken));

  app.onError((error, c) => {
    const body = error instanceof HTTPException ? httpProblem(error) : problemFromError(error);
    if (body.status >= 500 && body.code === "INTERNAL") {
      log?.(`ERROR ${c.req.method} ${c.req.path}: ${error.stack ?? String(error)}`);
    }
    return problemResponse({ ...body, instance: c.req.path });
  });

  app.notFound((c) => {
    const path = c.req.path;
    if (path === "/api" || path.startsWith("/api/") || !SAFE_METHODS.has(c.req.method)) {
      return problemResponse(
        problem("NOT_FOUND", `No route for ${c.req.method} ${path}`, { instance: path }),
      );
    }
    return serveWeb(webAssets, c.req.method, path);
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Required for PUT/POST only when the server has `CP750_API_TOKEN` set.",
  });

  /** HTTP-side checks before any mutation; the session repeats them. */
  function guardMutation(name: string, confirm: boolean | undefined): CommandInfo | undefined {
    const command = findCommand(session, name);
    const target = command?.name ?? normalizeParamName(name);
    if (config.readOnly || session.state.readOnly) {
      throw new Forbidden(target, "read-only-mode", `${target}: the server is in read-only mode`);
    }
    if (command?.spec?.destructive && confirm !== true) {
      throw new Forbidden(
        target,
        "confirmation-required",
        `${target} is destructive; send "confirm": true to proceed`,
      );
    }
    return command;
  }

  app
    .openapi(healthRoute, (c) => c.json({ status: "ok" as const, version: SERVER_VERSION }, 200))
    .openapi(deviceRoute, (c) => {
      const state = session.state;
      return c.json(
        {
          connection: state.connection,
          host: state.host,
          port: state.port,
          firmware: state.firmware,
          manifest: state.manifest,
          fullControl: state.fullControl,
          readOnly: config.readOnly || state.readOnly,
          allowFull: state.allowFull,
          allowInternal: state.allowInternal,
          authRequired: config.apiToken !== undefined,
          lastError: state.lastError,
        },
        200,
      );
    });
  app.openapi(commandsRoute, (c) => {
    const state = session.state;
    return c.json(
      {
        firmware: state.firmware,
        manifest: state.manifest,
        commands: session.commands().map(toCommand),
      },
      200,
    );
  });
  app.openapi(readParamRoute, async (c) => {
    const { name } = c.req.valid("param");
    const result = await session.read(name);
    return c.json(toReading(session, result), 200);
  });
  app.openapi(writeParamRoute, async (c) => {
    const { name } = c.req.valid("param");
    const { value, confirm } = c.req.valid("json");
    guardMutation(name, confirm);
    const result = await session.write(name, value, { confirm: confirm === true });
    return c.json(toReading(session, result), 200);
  });
  app.openapi(actionRoute, async (c) => {
    const { name } = c.req.valid("param");
    const body = c.req.valid("json") ?? {};
    guardMutation(name, body.confirm);
    const result = await session.action(name, body.value, { confirm: body.confirm === true });
    return c.json({ name: result.name, value: result.value, raw: result.raw }, 200);
  });

  app.openAPIRegistry.registerPath(eventsRoute);
  app.get(eventsRoute.path, (c) => streamEvents(c, session, heartbeatMs));

  let document: Record<string, unknown> | undefined;
  app.openAPIRegistry.registerPath(openApiRoute);
  app.get(openApiRoute.path, (c) => {
    document ??= openApiDocument(app);
    return c.json(document);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

/** Builds the OpenAPI 3.1 document from the registered routes, with sorted keys. */
export function openApiDocument(app: OpenAPIHono): Record<string, unknown> {
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "CP750 REST gateway",
      version: SERVER_VERSION,
      description:
        "REST + SSE gateway for the Dolby CP750 Digital Cinema Processor. Param names and value types depend on the unit's firmware: discover them with `GET /api/commands`, which returns each param's JSON Schema. Errors are RFC 9457 `application/problem+json`.",
      license: { name: "MIT" },
    },
    tags: TAGS,
  });
  // Sorted keys everywhere, except the root, which keeps the conventional OpenAPI order.
  const sorted = sortKeys(doc) as Record<string, unknown>;
  const root: Record<string, unknown> = {};
  for (const key of ["openapi", "info", "tags", "paths", "webhooks", "components"]) {
    if (key in sorted) root[key] = sorted[key];
  }
  return { ...root, ...sorted };
}

function streamEvents(c: Context, session: Cp750Session, heartbeatMs: number): Response {
  return streamSSE(c, async (stream) => {
    let id = 0;
    let queue: Promise<void> = Promise.resolve();
    const send = (event: SessionEvent) => {
      queue = queue
        .then(() =>
          stream.writeSSE({ event: event.type, id: String(++id), data: JSON.stringify(event) }),
        )
        .catch(() => {});
    };

    const unsubscribe = session.subscribe(send);
    const state = session.state;
    const at = new Date().toISOString();
    send({ type: "connection", connection: state.connection, error: state.lastError, at });
    send({ type: "device", firmware: state.firmware, manifest: state.manifest, at });

    const heartbeat = setInterval(() => {
      queue = queue.then(() => stream.write(": ping\n\n").then(() => {})).catch(() => {});
    }, heartbeatMs);

    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
      const signal = c.req.raw.signal;
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    clearInterval(heartbeat);
    unsubscribe();
  });
}
