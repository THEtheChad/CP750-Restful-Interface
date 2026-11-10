/**
 * `bun test` preload for apps/web: happy-dom globals, CSS imports, and Testing Library's per-test
 * cleanup. Testing Library is imported dynamically so it sees `document` when it initializes.
 */
import { afterEach } from "bun:test";
import { readFile } from "node:fs/promises";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:2222/" });

// Vite handles CSS in the app; in tests a CSS module maps each class to its own name.
Bun.plugin({
  name: "css",
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      const names = new Set([...source.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
      const classes = Object.fromEntries([...names].map((n) => [n, n]));
      return { exports: { default: classes }, loader: "object" };
    });
    build.onLoad({ filter: /\.css$/ }, () => ({ exports: {}, loader: "object" }));
  },
});

const { cleanup } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.location.hash = "";
});
