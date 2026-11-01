import type { DedupeStore, StateStore } from "./types.ts";

export type Clock = () => number;
const DEDUPE_TTL_SECONDS = 7 * 24 * 3600; // Stripe retries for about 3 days.

export function memoryState(max = 10_000, now: Clock = Date.now): StateStore {
  const map = new Map<string, { value: string; expires?: number }>();
  return {
    async get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.expires !== undefined && hit.expires <= now()) {
        map.delete(key);
        return null;
      }
      return hit.value;
    },
    async put(key, value, ttlSeconds) {
      map.delete(key); // re-insert so it counts as newest
      map.set(key, { value, expires: ttlSeconds ? now() + ttlSeconds * 1000 : undefined });
      if (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
    },
  };
}

/** The slice of Cloudflare's KVNamespace we use. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function kvState(kv: KVLike): StateStore {
  return {
    get: (key) => kv.get(key),
    // KV rejects TTLs under 60 seconds.
    put: (key, value, ttl) => kv.put(key, value, ttl ? { expirationTtl: Math.max(60, ttl) } : undefined),
  };
}

export function stateDedupe(state: StateStore): DedupeStore {
  return {
    async has(key) {
      return (await state.get(`dedupe:${key}`)) !== null;
    },
    add: (key) => state.put(`dedupe:${key}`, "1", DEDUPE_TTL_SECONDS),
  };
}

export function memoryDedupe(max = 5000): DedupeStore {
  return stateDedupe(memoryState(max));
}

/** Never drop a sale because the durable store is down: fall back to memory and say so. */
export function resilientDedupe(primary: DedupeStore, log: (message: string) => void): DedupeStore {
  const fallback = memoryDedupe();
  return {
    async has(key) {
      try {
        return (await primary.has(key)) || (await fallback.has(key));
      } catch (err) {
        log(`dedupe store unavailable, using memory: ${err instanceof Error ? err.message : String(err)}`);
        return fallback.has(key);
      }
    },
    async add(key) {
      await fallback.add(key);
      try {
        await primary.add(key);
      } catch (err) {
        log(`dedupe store unavailable, using memory: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
