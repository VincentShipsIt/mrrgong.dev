import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MRR_MILESTONES,
  DEFAULT_SALE_MILESTONES,
  createMilestoneTracker,
  emptyState,
  fileMilestoneStore,
  kvMilestoneStore,
  memoryMilestoneStore,
  nextMrrMilestone,
  nextSaleMilestone,
  ordinal,
  parseSimulatedMilestone,
  parseThresholds,
} from "../src/milestones.ts";

describe("ordinal", () => {
  it("handles the awkward teens and 1/2/3", () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 100, 101, 111, 1000].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "10th", "11th", "12th", "13th", "21st", "22nd", "100th", "101st", "111th", "1,000th",
    ]);
  });
});

describe("parseThresholds", () => {
  it("parses, sorts and de-duplicates", () => {
    expect(parseThresholds("1000, 100,100, 5", "X", [9])).toEqual([5, 100, 1000]);
  });
  it("falls back when unset and allows an explicit empty list", () => {
    expect(parseThresholds(undefined, "X", [9])).toEqual([9]);
    expect(parseThresholds("none", "X", [9])).toEqual([]);
  });
  it("rejects junk", () => {
    expect(() => parseThresholds("10,abc", "X", [])).toThrow(/X/);
    expect(() => parseThresholds("-5", "X", [])).toThrow(/X/);
  });
});

describe("nextSaleMilestone", () => {
  const th = DEFAULT_SALE_MILESTONES;
  it("announces the first sale", () => {
    const { state, milestone } = nextSaleMilestone({ ...emptyState(), salesSeeded: true }, th);
    expect(state.sales).toBe(1);
    expect(milestone).toMatchObject({ kind: "first_sale", title: "🎉 First sale!" });
  });
  it("announces the Nth sale once and nothing in between", () => {
    let state = { ...emptyState(), salesSeeded: true, sales: 8, firedSales: [1] };
    let r = nextSaleMilestone(state, th);
    expect(r.milestone).toBeUndefined();
    r = nextSaleMilestone(r.state, th);
    expect(r.state.sales).toBe(10);
    expect(r.milestone).toMatchObject({ kind: "sales", title: "🎉 10th sale!" });
    expect(nextSaleMilestone(r.state, th).milestone).toBeUndefined();
  });
  it("never repeats a fired milestone", () => {
    const state = { ...emptyState(), salesSeeded: true, sales: 9, firedSales: [1, 10] };
    expect(nextSaleMilestone(state, th).milestone).toBeUndefined();
  });
  it("respects disabled thresholds", () => {
    expect(nextSaleMilestone({ ...emptyState(), salesSeeded: true }, []).milestone).toBeUndefined();
  });
});

describe("nextMrrMilestone", () => {
  const th = DEFAULT_MRR_MILESTONES;
  it("silently seeds on the first reading so an existing business does not announce old news", () => {
    const r = nextMrrMilestone(emptyState(), 250_000, "USD", th);
    expect(r.milestone).toBeUndefined();
    expect(r.state.mrrSeeded).toBe(true);
    expect(r.state.firedMrr).toEqual([100, 500, 1000]);
  });
  it("announces a threshold the first time it is crossed", () => {
    const seeded = nextMrrMilestone(emptyState(), 40_000, "USD", th).state;
    const r = nextMrrMilestone(seeded, 52_000, "USD", th);
    expect(r.milestone).toMatchObject({ kind: "mrr", title: "🎉 MRR crossed $500.00!" });
    expect(nextMrrMilestone(r.state, 53_000, "USD", th).milestone).toBeUndefined();
  });
  it("announces only the highest threshold when several are jumped at once", () => {
    const seeded = nextMrrMilestone(emptyState(), 0, "USD", th).state;
    const r = nextMrrMilestone(seeded, 600_000, "USD", th);
    expect(r.milestone?.title).toBe("🎉 MRR crossed $5,000.00!");
    expect(r.state.firedMrr).toEqual([100, 500, 1000, 5000]);
  });
  it("does not re-announce after a dip and recovery", () => {
    let r = nextMrrMilestone(emptyState(), 0, "USD", th);
    r = nextMrrMilestone(r.state, 11_000, "USD", th);
    expect(r.milestone).toBeDefined();
    r = nextMrrMilestone(r.state, 9_000, "USD", th);
    r = nextMrrMilestone(r.state, 11_000, "USD", th);
    expect(r.milestone).toBeUndefined();
  });
});

describe("stores", () => {
  it("memory store round-trips", async () => {
    const s = memoryMilestoneStore();
    expect(await s.load()).toEqual(emptyState());
    await s.save({ ...emptyState(), sales: 3 });
    expect((await s.load()).sales).toBe(3);
  });
  it("file store survives a restart and tolerates corruption", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mrrgong-ms-"));
    const file = join(dir, "milestones.json");
    await fileMilestoneStore(file).save({ ...emptyState(), sales: 7, firedSales: [1] });
    expect(await fileMilestoneStore(file).load()).toMatchObject({ sales: 7, firedSales: [1] });
    await writeFile(file, "{nope");
    expect(await fileMilestoneStore(file).load()).toEqual(emptyState());
    await fileMilestoneStore(file).save({ ...emptyState(), sales: 1 });
    expect(JSON.parse(await readFile(file, "utf8")).sales).toBe(1);
  });
  it("file store ignores wrong-shaped fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mrrgong-ms-"));
    const file = join(dir, "m.json");
    await writeFile(file, JSON.stringify({ sales: "x", firedSales: [1, "y"], firedMrr: 5 }));
    expect(await fileMilestoneStore(file).load()).toMatchObject({ sales: 0, firedSales: [1], firedMrr: [] });
  });
  it("kv store round-trips", async () => {
    const data = new Map<string, string>();
    const kv = { get: async (k: string) => data.get(k) ?? null, put: async (k: string, v: string) => void data.set(k, v) };
    const s = kvMilestoneStore(kv);
    expect(await s.load()).toEqual(emptyState());
    await s.save({ ...emptyState(), sales: 2 });
    expect((await kvMilestoneStore(kv).load()).sales).toBe(2);
  });
});

describe("createMilestoneTracker", () => {
  const cfg = { mrr: DEFAULT_MRR_MILESTONES, sales: DEFAULT_SALE_MILESTONES, initialSales: 0 };
  it("counts sales, persists, and resumes after a restart without repeating", async () => {
    const store = memoryMilestoneStore();
    const a = createMilestoneTracker(store, cfg);
    expect((await a.recordSale())?.kind).toBe("first_sale");
    expect(await a.recordSale()).toBeUndefined();
    const b = createMilestoneTracker(store, cfg); // "restart"
    expect(await b.recordSale()).toBeUndefined();
    expect((await store.load()).sales).toBe(3);
  });
  it("serialises concurrent sales so none is lost or doubled", async () => {
    const tracker = createMilestoneTracker(memoryMilestoneStore(), cfg);
    const results = await Promise.all(Array.from({ length: 10 }, () => tracker.recordSale()));
    expect(results.filter(Boolean).map((m) => m?.title)).toEqual(["🎉 First sale!", "🎉 10th sale!"]);
  });
  it("seeds the count from initialSales so an existing business skips the false 'first sale'", async () => {
    const store = memoryMilestoneStore();
    const tracker = createMilestoneTracker(store, { ...cfg, initialSales: 95 });
    for (let i = 0; i < 4; i++) expect(await tracker.recordSale()).toBeUndefined();
    expect((await tracker.recordSale())?.title).toBe("🎉 100th sale!");
    expect((await store.load()).sales).toBe(100);
  });
  it("tracks MRR", async () => {
    const tracker = createMilestoneTracker(memoryMilestoneStore(), cfg);
    expect(await tracker.recordMrr(0, "USD")).toBeUndefined();
    expect((await tracker.recordMrr(15_000, "USD"))?.title).toBe("🎉 MRR crossed $100.00!");
  });
  it("keeps going when the store fails", async () => {
    const broken = { load: async () => { throw new Error("disk"); }, save: async () => { throw new Error("disk"); } };
    const logs: string[] = [];
    const tracker = createMilestoneTracker(broken, cfg, (m) => logs.push(m));
    expect(await tracker.recordSale()).toBeUndefined();
    expect(logs[0]).toMatch(/disk/);
  });
});

describe("parseSimulatedMilestone", () => {
  const ev = (over: Record<string, unknown> = {}) => ({ type: "mrrgong.simulate.milestone", livemode: false, data: { object: { kind: "mrr", amount: 500, currency: "usd" } }, ...over });
  it("turns a test-mode MRR preview into a milestone", () => {
    expect(parseSimulatedMilestone(ev())).toEqual({ kind: "mrr", title: "🎉 MRR crossed $500.00!" });
  });
  it("turns a sales preview into a milestone", () => {
    expect(parseSimulatedMilestone(ev({ data: { object: { kind: "sales", count: 1 } } }))).toEqual({ kind: "first_sale", title: "🎉 First sale!" });
    expect(parseSimulatedMilestone(ev({ data: { object: { kind: "sales", count: 100 } } }))?.title).toBe("🎉 100th sale!");
  });
  it("refuses live-mode events, other types and malformed objects", () => {
    expect(parseSimulatedMilestone(ev({ livemode: true }))).toBeNull();
    expect(parseSimulatedMilestone(ev({ type: "checkout.session.completed" }))).toBeNull();
    for (const object of [null, {}, { kind: "mrr", amount: -1, currency: "usd" }, { kind: "mrr", amount: 5, currency: "dollars" }, { kind: "sales", count: 0 }, { kind: "sales", count: 1.5 }, { kind: "x" }]) {
      expect(parseSimulatedMilestone(ev({ data: { object } }))).toBeNull();
    }
    expect(parseSimulatedMilestone(null)).toBeNull();
  });
});
