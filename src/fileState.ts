import { readFile, rename, writeFile } from "node:fs/promises";
import type { Clock } from "./state.ts";
import type { StateStore } from "./types.ts";

/** JSON file store for the Node server. Writes are serialised and atomic. */
export function fileState(file: string, now: Clock = Date.now): StateStore {
  type Table = Record<string, { v: string; e?: number }>;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Table> {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Table) : {};
    } catch {
      return {};
    }
  }

  return {
    async get(key) {
      await queue.catch(() => {});
      const hit = (await load())[key];
      if (!hit || (hit.e !== undefined && hit.e <= now())) return null;
      return hit.v;
    },
    put(key, value, ttlSeconds) {
      const run = queue.catch(() => {}).then(async () => {
        const table = await load();
        for (const [k, entry] of Object.entries(table)) if (entry.e !== undefined && entry.e <= now()) delete table[k];
        table[key] = { v: value, e: ttlSeconds ? now() + ttlSeconds * 1000 : undefined };
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(table));
        await rename(tmp, file);
      });
      queue = run;
      return run;
    },
  };
}
