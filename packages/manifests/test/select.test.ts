import { describe, expect, test } from "bun:test";
import { builtinManifests, type ManifestSelection, selectManifest } from "../src/index.ts";
import { makeManifest } from "./helpers.ts";

describe("selectManifest", () => {
  const verified = makeManifest("1.0.0.150183", "verified");
  const draft = makeManifest("1.2.8.3", "draft");
  const manifests = [draft, verified];

  test("exact verified", () => {
    expect(selectManifest("1.0.0.150183", manifests)).toEqual({
      manifest: verified,
      match: "exact",
      verified: true,
    });
  });

  test("exact draft is not verified", () => {
    expect(selectManifest("1.2.8.3", manifests)).toEqual({
      manifest: draft,
      match: "exact",
      verified: false,
    });
  });

  test("nearest picks the highest firmware at or below the unit's", () => {
    expect(selectManifest("1.1.0", manifests)).toEqual({
      manifest: verified,
      match: "nearest",
      verified: false,
    });
    expect(selectManifest("2.0", manifests)).toEqual({
      manifest: draft,
      match: "nearest",
      verified: false,
    });
  });

  test("none when everything is newer, the list is empty or the version is garbage", () => {
    const none: ManifestSelection = { manifest: null, match: "none", verified: false };
    expect(selectManifest("0.9", manifests)).toEqual(none);
    expect(selectManifest("1.0.0.150183", [])).toEqual(none);
    expect(selectManifest("", manifests)).toEqual(none);
    expect(selectManifest("unknown", manifests)).toEqual(none);
  });

  test("works on the built-ins", () => {
    const result = selectManifest(" 1.0.0.150183 ", builtinManifests());
    expect(result.match).toBe("exact");
    expect(result.verified).toBe(true);
    expect(result.manifest?.firmware).toBe("1.0.0.150183");
  });
});
