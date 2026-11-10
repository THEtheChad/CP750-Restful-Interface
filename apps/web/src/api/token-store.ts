/**
 * The API token for mutations, kept in `sessionStorage` so it lasts for the browser tab only.
 * Storage can be unavailable (private mode, blocked site data), so every access is guarded and
 * the token then lives in memory.
 */
const KEY = "cp750.apiToken";

export interface TokenStore {
  get(): string | null;
  set(token: string | null): void;
  subscribe(listener: () => void): () => void;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function createTokenStore(storage: StorageLike | null = defaultStorage()): TokenStore {
  let token: string | null = null;
  try {
    token = storage?.getItem(KEY) || null;
  } catch {
    token = null;
  }
  const listeners = new Set<() => void>();
  return {
    get: () => token,
    set(next) {
      token = next?.trim() || null;
      try {
        if (token) storage?.setItem(KEY, token);
        else storage?.removeItem(KEY);
      } catch {
        // Storage refused: keep the token in memory for this page only.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
