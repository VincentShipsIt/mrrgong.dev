import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fileState } from "../src/fileState.ts";
import { kvState, memoryDedupe, memoryState, resilientDedupe, stateDedupe } from "../src/state.ts";
import type { DedupeStore } from "../src/types.ts";

describe("memoryState", () => {
  it("stores, overwrites and misses", async () => {
    const s = memoryState();
    expect(await s.get("a")).toBeNull();
    await s.put("a", "1");
    await s.put("a", "2");
    expect(await s.get("a")).toBe("2");
  });
  it("expires keys after their ttl", async () => {
    let now = 1_000_000;
    const s = memoryState(100, () => now);
    await s.put("a", "1", 10);
    expect(await s.get("a")).toBe("1");
    now += 11_000;
    expect(await s.get("a")).toBeNull();
  });
  it("evicts the oldest key past its cap", async () => {
    const s = memoryState(2);
    await s.put("a", "1"); await s.put("b", "2"); await s.put("c", "3");
    expect(await s.get("a")).toBeNull();
    expect(await s.get("c")).toBe("3");
  });
});

describe("fileState", () => {
  it("persists across instances", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "state-")), "state.json");
    await fileState(file).put("k", "v");
    expect(await fileState(file).get("k")).toBe("v");
  });
  it("honours ttl and prunes expired keys on write", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "state-")), "state.json");
    let now = 1_000_000;
    const s = fileState(file, () => now);
    await s.put("old", "1", 5);
    now += 6_000;
    expect(await s.get("old")).toBeNull();
    await s.put("new", "2");
    expect(JSON.parse(await readFile(file, "utf8"))).not.toHaveProperty("old");
  });
  it("survives a corrupt file", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "state-")), "state.json");
    await writeFile(file, "{nope");
    const s = fileState(file);
    expect(await s.get("k")).toBeNull();
    await s.put("k", "v");
    expect(await s.get("k")).toBe("v");
  });
  it("serialises concurrent writes without losing keys", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "state-")), "state.json");
    const s = fileState(file);
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.put(`k${i}`, String(i))));
    for (let i = 0; i < 20; i++) expect(await fileState(file).get(`k${i}`)).toBe(String(i));
  });
});

describe("kvState", () => {
  it("maps to the KV namespace API with a ttl floor of 60s", async () => {
    const kv = { get: vi.fn(async () => "v"), put: vi.fn(async () => {}) };
    const s = kvState(kv);
    expect(await s.get("k")).toBe("v");
    await s.put("k", "v", 10);
    expect(kv.put).toHaveBeenCalledWith("k", "v", { expirationTtl: 60 });
    await s.put("k2", "v");
    expect(kv.put).toHaveBeenLastCalledWith("k2", "v", undefined);
  });
});

describe("dedupe stores", () => {
  it("memoryDedupe remembers keys and evicts the oldest past its cap", async () => {
    const d = memoryDedupe(2);
    await d.add("a"); await d.add("b"); await d.add("c");
    expect(await d.has("a")).toBe(false);
    expect(await d.has("c")).toBe(true);
  });
  it("stateDedupe namespaces keys in the state store", async () => {
    const state = memoryState();
    const d = stateDedupe(state);
    await d.add("pi_1");
    expect(await d.has("pi_1")).toBe(true);
    expect(await d.has("pi_2")).toBe(false);
    expect(await state.get("dedupe:pi_1")).toBe("1");
  });
  it("resilientDedupe falls back to memory when the primary throws, and logs", async () => {
    const broken: DedupeStore = { has: async () => { throw new Error("kv down"); }, add: async () => { throw new Error("kv down"); } };
    const log = vi.fn();
    const d = resilientDedupe(broken, log);
    expect(await d.has("x")).toBe(false);
    await d.add("x");
    expect(await d.has("x")).toBe(true);
    expect(log).toHaveBeenCalled();
  });
  it("resilientDedupe uses the primary when it works", async () => {
    const primary = stateDedupe(memoryState());
    const d = resilientDedupe(primary, () => {});
    await d.add("x");
    expect(await primary.has("x")).toBe(true);
  });
});
