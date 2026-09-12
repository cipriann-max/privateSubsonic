import { LRUCache } from "lru-cache";
import { config } from "./config.js";

/**
 * Short-lived in-memory cache for provider results, keyed by query.
 * No persistence — the catalog is always live from the provider.
 */

// lru-cache v11 constrains its value type to `{}` (non-null values only).
// Cached provider payloads are always JSON objects, so `object` fits.
export const queryCache = new LRUCache<string, object>({
  max: config.cache.maxEntries,
  ttl: config.cache.ttlSeconds * 1000,
});

/** Get-or-load helper. Stores the resolved value; errors are not cached. */
export async function cached<T extends object>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = queryCache.get(key) as T | undefined;
  if (hit !== undefined) {
    return hit;
  }
  const value = await load();
  queryCache.set(key, value);
  return value;
}