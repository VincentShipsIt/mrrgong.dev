import { describe, expect, it } from "vitest";
import { checkMrrMilestones, checkSaleMilestones } from "../src/milestones.ts";
import type { MrrSummary } from "../src/mrr.ts";
import { memoryState } from "../src/state.ts";
import type { Sale } from "../src/types.ts";

const sale = (over: Partial<Sale> = {}): Sale => ({
  dedupeKey: "pi", amountMinor: 1000, currency: "USD", kind: "one_time", livemode: true, created: 1, ...over,
});
const mrr = (mrrMinor: number, streakDays = 0, currency = "USD"): MrrSummary => ({
  mrrMinor, currency, formatted: "x", todayDeltaMinor: 0, streakDays,
});

describe("checkSaleMilestones", () => {
  it("fires 'first sale' once, then the 10th, 100th, and nothing in between", async () => {
    const state = memoryState();
    const fired: string[] = [];
    for (let i = 1; i <= 100; i++) for (const m of await checkSaleMilestones(state, sale())) fired.push(`${i}:${m.kind}:${m.text}`);
    expect(fired).toEqual([
      "1:first_sale:First sale ever. Someone paid for your thing.",
      "10:sales:10 sales and counting.",
      "100:sales:100 sales and counting.",
    ]);
  });
  it("does not count renewals or test-mode sales", async () => {
    const state = memoryState();
    expect(await checkSaleMilestones(state, sale({ kind: "renewal" }))).toEqual([]);
    expect(await checkSaleMilestones(state, sale({ livemode: false }))).toEqual([]);
    expect((await checkSaleMilestones(state, sale())).map((m) => m.kind)).toEqual(["first_sale"]);
  });
  it("remembers across a restart (shared state)", async () => {
    const state = memoryState();
    await checkSaleMilestones(state, sale());
    expect(await checkSaleMilestones(state, sale())).toEqual([]);
  });
  it("tolerates a corrupt counter", async () => {
    const state = memoryState();
    await state.put("stats:sales", "banana");
    expect((await checkSaleMilestones(state, sale())).map((m) => m.kind)).toEqual(["first_sale"]);
  });
});

describe("checkMrrMilestones", () => {
  it("stays silent on the first sighting, even if MRR is already high", async () => {
    const state = memoryState();
    expect(await checkMrrMilestones(state, mrr(300_000))).toEqual([]);
    expect(await checkMrrMilestones(state, mrr(300_000))).toEqual([]);
  });
  it("then announces only the highest newly crossed threshold, once", async () => {
    const state = memoryState();
    await checkMrrMilestones(state, mrr(5_000)); // $50, init
    const m = await checkMrrMilestones(state, mrr(250_000)); // jumps past $100, $500, $1,000
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "mrr", text: "MRR just crossed $1,000." });
    expect(await checkMrrMilestones(state, mrr(260_000))).toEqual([]);
    expect((await checkMrrMilestones(state, mrr(600_000)))[0]?.text).toBe("MRR just crossed $5,000.");
  });
  it("does not re-announce after MRR dips and recovers", async () => {
    const state = memoryState();
    await checkMrrMilestones(state, mrr(5_000));
    await checkMrrMilestones(state, mrr(120_000));
    await checkMrrMilestones(state, mrr(90_000));
    expect(await checkMrrMilestones(state, mrr(120_000))).toEqual([]);
  });
  it("announces streak milestones once", async () => {
    const state = memoryState();
    await checkMrrMilestones(state, mrr(5_000, 0));
    expect((await checkMrrMilestones(state, mrr(5_000, 7)))[0]).toMatchObject({ kind: "streak", text: "MRR is up 7 days in a row." });
    expect(await checkMrrMilestones(state, mrr(5_000, 8))).toEqual([]);
    expect((await checkMrrMilestones(state, mrr(5_000, 30)))[0]?.text).toBe("MRR is up 30 days in a row.");
  });
  it("tracks currencies independently and formats zero-decimal currencies", async () => {
    const state = memoryState();
    await checkMrrMilestones(state, mrr(0, 0, "JPY"));
    expect((await checkMrrMilestones(state, mrr(1000, 0, "JPY")))[0]?.text).toBe("MRR just crossed ¥1,000.");
  });
});
