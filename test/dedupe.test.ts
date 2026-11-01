import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackDedupe, fileDedupe, kvDedupe, memoryDedupe, type KvLike } from "../src/dedupe.ts";

const DAY = 86_400_000;

function fakeKv() {
  const data = new Map<string, { value: string; ttl?: number }>();
  const kv: KvLike = {
    get: async (key) => data.get(key)?.value ?? null,
    put: async (key, value, opts) => {
      data.set(key, { value, ttl: opts?.expirationTtl });
    },
  };
  return { kv, data };
}

describe("memoryDedupe", () => {
  it("remembers keys and evicts the oldest past max", async () => {
    const d = memoryDedupe(2);
    await d.add("a");
    await d.add("b");
    await d.add("c");
    expect(await d.has("a")).toBe(false);
    expect(await d.has("b")).toBe(true);
    expect(await d.has("c")).toBe(true);
  });
});

describe("kvDedupe", () => {
  it("stores keys with a seven day expiry and reports them back", async () => {
    const { kv, data } = fakeKv();
    const d = kvDedupe(kv);
    expect(await d.has("pi_1")).toBe(false);
    await d.add("pi_1");
    expect(await d.has("pi_1")).toBe(true);
    expect(data.get("mrrgong:dedupe:pi_1")?.ttl).toBe(7 * 86_400);
  });
  it("is shared between two instances over one namespace (two isolates)", async () => {
    const { kv } = fakeKv();
    await kvDedupe(kv).add("pi_2");
    expect(await kvDedupe(kv).has("pi_2")).toBe(true);
  });
});

describe("fileDedupe", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mrrgong-dedupe-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("survives a restart", async () => {
    const file = join(dir, "dedupe.json");
    await fileDedupe(file).add("pi_1");
    const restarted = fileDedupe(file);
    expect(await restarted.has("pi_1")).toBe(true);
    expect(await restarted.has("pi_other")).toBe(false);
  });
  it("forgets keys after the ttl and prunes them from disk", async () => {
    const file = join(dir, "dedupe.json");
    let t = 1_000_000;
    const d = fileDedupe(file, { ttlMs: 7 * DAY, now: () => t });
    await d.add("pi_1");
    t += 7 * DAY + 1;
    expect(await d.has("pi_1")).toBe(false);
    await d.add("pi_2");
    expect(Object.keys(JSON.parse(await readFile(file, "utf8")))).toEqual(["pi_2"]);
  });
  it("treats a corrupt or missing file as empty", async () => {
    const file = join(dir, "dedupe.json");
    await writeFile(file, "{not json");
    const d = fileDedupe(file);
    expect(await d.has("pi_1")).toBe(false);
    await d.add("pi_1");
    expect(await fileDedupe(file).has("pi_1")).toBe(true);
  });
  it("handles concurrent adds without losing keys", async () => {
    const file = join(dir, "dedupe.json");
    const d = fileDedupe(file);
    await Promise.all(["a", "b", "c", "d"].map((k) => d.add(k)));
    const again = fileDedupe(file);
    for (const k of ["a", "b", "c", "d"]) expect(await again.has(k)).toBe(true);
  });
  it("rejects add when the file cannot be written", async () => {
    const d = fileDedupe(join(dir, "missing-dir", "dedupe.json"));
    await expect(d.add("pi_1")).rejects.toThrow();
  });
});

describe("fallbackDedupe", () => {
  const broken = () => ({
    has: vi.fn().mockRejectedValue(new Error("kv down")),
    add: vi.fn().mockRejectedValue(new Error("kv down")),
  });

  it("uses the durable store when it works", async () => {
    const { kv } = fakeKv();
    const d = fallbackDedupe(kvDedupe(kv), memoryDedupe(), vi.fn());
    await d.add("pi_1");
    expect(await d.has("pi_1")).toBe(true);
    expect(await kvDedupe(kv).has("pi_1")).toBe(true);
  });
  it("falls back to memory and warns once per failure instead of throwing", async () => {
    const log = vi.fn();
    const d = fallbackDedupe(broken(), memoryDedupe(), log);
    expect(await d.has("pi_1")).toBe(false);
    await expect(d.add("pi_1")).resolves.toBeUndefined();
    expect(await d.has("pi_1")).toBe(true);
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.every(([m]) => /durable dedupe/i.test(String(m)))).toBe(true);
  });
  it("still remembers in memory when the durable add fails but reads work", async () => {
    const { kv } = fakeKv();
    const primary = { ...kvDedupe(kv), add: vi.fn().mockRejectedValue(new Error("write failed")) };
    const d = fallbackDedupe(primary, memoryDedupe(), vi.fn());
    await d.add("pi_1");
    expect(await d.has("pi_1")).toBe(true);
  });
});
