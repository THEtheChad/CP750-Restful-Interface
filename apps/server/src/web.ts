/**
 * Serves the web client from an asset map (URL path -> file path). In a compiled executable the
 * file paths point into Bun's embedded filesystem (`/$bunfs/...`), see
 * `scripts/web-assets.ts`; from source they are ordinary paths under `apps/web/dist`.
 */
import { extname } from "node:path";

/** URL path (e.g. `/index.html`, `/assets/app-abc123.js`) to a path `Bun.file` can open. */
export type WebAssets = Readonly<Record<string, string>>;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const NOTICE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>CP750 gateway</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
<h1>CP750 gateway</h1>
<p>The API is running, but this build does not include the web client.</p>
<p>Try <a href="/api/device">/api/device</a>, <a href="/api/commands">/api/commands</a>
or the OpenAPI document at <a href="/api/openapi.json">/api/openapi.json</a>.</p>
</body>
</html>
`;

function fileResponse(urlPath: string, filePath: string, method: string): Response {
  const ext = extname(urlPath).toLowerCase();
  const file = Bun.file(filePath);
  const immutable = urlPath.startsWith("/assets/");
  return new Response(method === "HEAD" ? null : file, {
    headers: {
      "content-type": TYPES[ext] ?? (file.type || "application/octet-stream"),
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}

/**
 * Answers a non-API GET/HEAD: an exact asset, else `index.html` for extension-less paths (SPA
 * routes), else 404. Without a web build, extension-less paths get a short HTML notice.
 */
export function serveWeb(assets: WebAssets, method: string, path: string): Response {
  const urlPath = path === "/" ? "/index.html" : path;
  const exact = assets[urlPath];
  if (exact) return fileResponse(urlPath, exact, method);

  const isFile = path !== "/" && extname(path) !== "";
  if (isFile) {
    return new Response(method === "HEAD" ? null : "Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const index = assets["/index.html"];
  if (index) return fileResponse("/index.html", index, method);
  return new Response(method === "HEAD" ? null : NOTICE, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
  });
}
