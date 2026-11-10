/** Route definitions (OpenAPI operations). Handlers live in `app.ts`. */
import { createRoute, z } from "@hono/zod-openapi";
import {
  ActionRequestSchema,
  ActionResultSchema,
  CommandsSchema,
  DeviceSchema,
  HealthSchema,
  OpenApiDocumentSchema,
  ParamNameSchema,
  ParamReadingSchema,
  problemEntry,
  problemResponses,
  SessionEventSchema,
  WriteRequestSchema,
} from "./schemas.ts";

/** Mutations need the Bearer token when `CP750_API_TOKEN` is set; otherwise none. */
const MUTATION_SECURITY: Record<string, string[]>[] = [{ bearerAuth: [] }, {}];

export const TAGS = [
  { name: "system", description: "Health, device state and this document" },
  { name: "params", description: "Read and write CP750 parameters" },
  { name: "actions", description: "Trigger CP750 actions (`cp750.ctrl.*`)" },
  { name: "events", description: "Server-sent events" },
];

const nameParams = z.object({ name: ParamNameSchema });

/** Every route: the Host check (DNS rebinding) runs before routing. */
const HOST = problemResponses(421);

/** Mutations: JSON only, small bodies, and no cross-site callers. */
const MUTATION = {
  ...problemResponses(400, 401, 404, 413, 415, 421, 500, 503, 504),
  403: problemEntry(
    "FORBIDDEN",
    "Refused by the access policy (`FORBIDDEN`, see `reason`), or a cross-site request whose `Origin` is not allowed (`ORIGIN_NOT_ALLOWED`)",
  ),
};

export const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  operationId: "getHealth",
  tags: ["system"],
  summary: "Liveness",
  description: "Answers as long as the HTTP server runs, whether or not the CP750 is reachable.",
  responses: {
    200: { description: "Alive", content: { "application/json": { schema: HealthSchema } } },
    ...HOST,
  },
});

export const deviceRoute = createRoute({
  method: "get",
  path: "/api/device",
  operationId: "getDevice",
  tags: ["system"],
  summary: "Connection and firmware state",
  responses: {
    200: {
      description: "Current session state",
      content: { "application/json": { schema: DeviceSchema } },
    },
    ...HOST,
  },
});

export const commandsRoute = createRoute({
  method: "get",
  path: "/api/commands",
  operationId: "listCommands",
  tags: ["params"],
  summary: "Parameters of the active manifest",
  description:
    "Every param the active firmware manifest (and `help`) knows, with its value JSON Schema, availability and the operations allowed right now. Empty before the first firmware detection.",
  responses: {
    200: {
      description: "The command list",
      content: { "application/json": { schema: CommandsSchema } },
    },
    ...HOST,
  },
});

export const readParamRoute = createRoute({
  method: "get",
  path: "/api/params/{name}",
  operationId: "readParam",
  tags: ["params"],
  summary: "Read a parameter",
  description: "Queries the unit (`<param> ?`). Faders also report `db`.",
  request: { params: nameParams },
  responses: {
    200: {
      description: "The current value",
      content: { "application/json": { schema: ParamReadingSchema } },
    },
    ...problemResponses(400, 403, 404, 421, 500, 503, 504),
  },
});

export const writeParamRoute = createRoute({
  method: "put",
  path: "/api/params/{name}",
  operationId: "writeParam",
  tags: ["params"],
  summary: "Write a parameter",
  description:
    "Validates the value against the param's schema, sends it, and compares the unit's echo with the request. A mismatch is `422 WRITE_REJECTED`.",
  security: MUTATION_SECURITY,
  request: {
    params: nameParams,
    body: {
      required: true,
      content: { "application/json": { schema: WriteRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "The value the unit now holds",
      content: { "application/json": { schema: ParamReadingSchema } },
    },
    ...MUTATION,
    ...problemResponses(422),
  },
});

export const actionRoute = createRoute({
  method: "post",
  path: "/api/actions/{name}",
  operationId: "triggerAction",
  tags: ["actions"],
  summary: "Trigger an action",
  description:
    "Sends an `action` param (`cp750.ctrl.*`); `value` defaults to 1. Destructive actions (reboot, default_params, log_erase…) need `confirm: true`. The request must be `Content-Type: application/json` even without a body; an empty body counts as `{}`.",
  security: MUTATION_SECURITY,
  request: {
    params: nameParams,
    body: {
      required: false,
      description:
        "Optional; an empty body counts as `{}`. `Content-Type: application/json` is required either way.",
      content: { "application/json": { schema: ActionRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "The unit's reply",
      content: { "application/json": { schema: ActionResultSchema } },
    },
    ...MUTATION,
  },
});

export const eventsRoute = createRoute({
  method: "get",
  path: "/api/events",
  operationId: "streamEvents",
  tags: ["events"],
  summary: "Live events (SSE)",
  description:
    "A `text/event-stream`. On connect it sends a `connection` and a `device` snapshot, then forwards the session's `param`, `connection` and `device` events. Each message's `event` is the type and `data` is a JSON `SessionEvent`. Comment lines (`: ping`) are heartbeats. The number of concurrent streams is capped (`CP750_MAX_SSE_CLIENTS`), and a client that stops reading is dropped once its backlog grows past a limit. `HEAD` answers the headers without opening a stream.",
  responses: {
    200: {
      description: "Event stream",
      content: { "text/event-stream": { schema: SessionEventSchema } },
    },
    ...HOST,
    503: problemEntry(
      "TOO_MANY_STREAMS",
      "Too many event streams are open (`TOO_MANY_STREAMS`); see `CP750_MAX_SSE_CLIENTS`",
    ),
  },
});

export const openApiRoute = createRoute({
  method: "get",
  path: "/api/openapi.json",
  operationId: "getOpenApi",
  tags: ["system"],
  summary: "This OpenAPI document",
  responses: {
    200: {
      description: "OpenAPI 3.1 document",
      content: { "application/json": { schema: OpenApiDocumentSchema } },
    },
    ...HOST,
  },
});
