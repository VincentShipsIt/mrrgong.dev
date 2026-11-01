import { readFile, rename, writeFile } from "node:fs/promises";
import type { DedupeStore } from "./types.ts";

/** Stripe retries for up to three days; a week leaves a wide margin. */
export const DEDUPE_TTL_MS = 7 * 86_400_000;

export function memoryDedupe(max = 5000): DedupeStore {
  const seen = new Set<string>();
  return {
    async has(key) {
      return seen.has(key);
    },
    async add(key) {
      seen.add(key);
      if (seen.size > max) seen.delete(seen.values().next().value as string);
    },
  };
}

/** The slice of a Cloudflare KV namespace we use, so tests and other KVs can stand in. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function kvDedupe(kv: KvLike, ttlMs = DEDUPE_TTL_MS): DedupeStore {
  const name = (key: string) => `mrrgong:dedupe:${key}`;
  return {
    async has(key) {
      return (await kv.get(name(key))) !== null;
    },
    async add(key) {
      await kv.put(name(key), "1", { expirationTtl: Math.ceil(ttlMs / 1000) });
    },
  };
}

export interface FileDedupeOptions {
  ttlMs?: number;
  now?: () => number;
}

/** Node: keys and their expiry in a small JSON file, written atomically. */
export function fileDedupe(file: string, options: FileDedupeOptions = {}): DedupeStore {
  const { ttlMs = DEDUPE_TTL_MS, now = Date.now } = options;
  let entries: Map<string, number> | undefined;
  let writes: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Map<string, number>> {
    if (entries) return entries;
    const map = new Map<string, number>();
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (typeof parsed === "object" && parsed !== null) {
        for (const [key, expires] of Object.entries(parsed)) if (typeof expires === "number") map.set(key, expires);
      }
    } catch {
      // Missing or corrupt: start empty. A lost dedupe file is not worth refusing sales over.
    }
    return (entries ??= map);
  }

  function prune(map: Map<string, number>) {
    const t = now();
    for (const [key, expires] of map) if (expires <= t) map.delete(key);
  }

  return {
    async has(key) {
      const map = await load();
      const expires = map.get(key);
      return expires !== undefined && expires > now();
    },
    add(key) {
      const run = async () => {
        const map = await load();
        prune(map);
        map.set(key, now() + ttlMs);
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(Object.fromEntries(map)));
        await rename(tmp, file); // atomic, so a crash never leaves a half-written file
      };
      // Serialise writes so concurrent webhooks do not interleave on the temp file.
      const result = writes.then(run, run);
      writes = result.catch(() => {});
      return result;
    },
  };
}

/**
 * Prefers the durable store but never drops a sale because of it: on any failure it logs
 * a warning and relies on the in-memory store. Memory is always written too, so a durable
 * write that fails still dedupes within this process.
 */
export function fallbackDedupe(primary: DedupeStore, memory: DedupeStore, log: (message: string) => void): DedupeStore {
  const warn = (op: string, err: unknown) =>
    log(`warning: durable dedupe ${op} failed, using memory only: ${err instanceof Error ? err.message : String(err)}`);
  return {
    async has(key) {
      if (await memory.has(key)) return true;
      try {
        return await primary.has(key);
      } catch (err) {
        warn("read", err);
        return false;
      }
    },
    async add(key) {
      await memory.add(key);
      try {
        await primary.add(key);
      } catch (err) {
        warn("write", err);
      }
    },
  };
}
