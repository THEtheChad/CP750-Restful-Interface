import { describe, expect, test } from "bun:test";
import { createTokenStore } from "./token-store.ts";

describe("token store", () => {
  test("persists to sessionStorage and notifies", () => {
    const store = createTokenStore(window.sessionStorage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set("  abc ");
    expect(store.get()).toBe("abc");
    expect(createTokenStore(window.sessionStorage).get()).toBe("abc");
    store.set(null);
    expect(createTokenStore(window.sessionStorage).get()).toBeNull();
    expect(calls).toBe(2);
  });

  test("falls back to memory when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const store = createTokenStore(broken);
    expect(store.get()).toBeNull();
    store.set("abc");
    expect(store.get()).toBe("abc");
  });
});
