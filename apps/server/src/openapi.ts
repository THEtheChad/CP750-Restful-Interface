import { FakeSession } from "@cp750/device";
import { createApp, openApiDocument } from "./app.ts";
import { loadConfig } from "./config.ts";

/**
 * The OpenAPI 3.1 document, independent of any device or config: it is built from the route
 * definitions of an app over a `FakeSession`.
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  const app = createApp({ session: new FakeSession(), config: loadConfig({}) });
  return openApiDocument(app);
}

/** The committed form of the document: already key-sorted, two-space indent, trailing newline. */
export function openApiJson(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
