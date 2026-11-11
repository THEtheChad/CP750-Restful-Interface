/**
 * Which params have a write in flight, per query cache. While one does, SSE `param` events for it
 * are held back instead of overwriting the optimistic value; when the last write settles the
 * caller compares the held-back value with the cache and re-reads if they differ.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { ParamValue } from "./types.ts";

interface Entry {
  count: number;
  /** The newest `param` event that arrived while writes were pending. */
  held: { value: ParamValue } | null;
}

const registries = new WeakMap<QueryClient, Map<string, Entry>>();

function registry(queryClient: QueryClient): Map<string, Entry> {
  let map = registries.get(queryClient);
  if (!map) {
    map = new Map();
    registries.set(queryClient, map);
  }
  return map;
}

/** A write to `name` started. */
export function beginWrite(queryClient: QueryClient, name: string): void {
  const map = registry(queryClient);
  const entry = map.get(name) ?? { count: 0, held: null };
  entry.count++;
  map.set(name, entry);
}

/**
 * A write to `name` settled. When it was the last one, returns the newest event value held back
 * meanwhile (`null` if none arrived).
 */
export function endWrite(queryClient: QueryClient, name: string): { value: ParamValue } | null {
  const map = registry(queryClient);
  const entry = map.get(name);
  if (!entry) return null;
  entry.count--;
  if (entry.count > 0) return null;
  map.delete(name);
  return entry.held;
}

/** Holds the event back if a write to `name` is pending; returns whether it did. */
export function holdIfWriting(queryClient: QueryClient, name: string, value: ParamValue): boolean {
  const entry = registry(queryClient).get(name);
  if (!entry) return false;
  entry.held = { value };
  return true;
}

/** How many writes to `name` are pending (including the caller's own, until it settles). */
export function pendingWrites(queryClient: QueryClient, name: string): number {
  return registry(queryClient).get(name)?.count ?? 0;
}
