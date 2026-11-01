import { describe, expect, it, vi } from "vitest";
import { computeMrr, fetchActiveSubscriptions, mrrSummary, recordSnapshot, streakDays, type Snapshot } from "../src/mrr.ts";

const sub = (over: Record<string, unknown> = {}) => ({
  status: "active",
  currency: "usd",
  discounts: [],
  items: { data: [{ quantity: 1, price: { unit_amount: 2900, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] },
  ...over,
});
const item = (unit_amount: number, interval: string, interval_count = 1, quantity = 1, extra: Record<string, unknown> = {}) => ({
  quantity, price: { unit_amount, currency: "usd", recurring: { interval, interval_count }, ...extra },
});

describe("computeMrr", () => {
  it("sums monthly subscriptions", () => {
    expect(computeMrr([sub(), sub()])).toEqual({ USD: 5800 });
  });
  it("normalises yearly, weekly, daily and multi-month intervals to a month", () => {
    const s = (i: unknown) => sub({ items: { data: [i] } });
    expect(computeMrr([s(item(12000, "year"))])).toEqual({ USD: 1000 });
    expect(computeMrr([s(item(3000, "month", 3))])).toEqual({ USD: 1000 });
    expect(computeMrr([s(item(1200, "week"))])).toEqual({ USD: Math.round((1200 * 52) / 12) });
    expect(computeMrr([s(item(100, "day"))])).toEqual({ USD: 3000 });
  });
  it("multiplies by quantity", () => {
    expect(computeMrr([sub({ items: { data: [item(1000, "month", 1, 5)] } })])).toEqual({ USD: 5000 });
  });
  it("only counts active subscriptions (not trialing, canceled, past_due)", () => {
    expect(computeMrr([sub({ status: "trialing" }), sub({ status: "canceled" }), sub({ status: "past_due" })])).toEqual({});
  });
  it("applies percentage discounts", () => {
    const d = { coupon: { percent_off: 50 } };
    expect(computeMrr([sub({ discounts: [d] })])).toEqual({ USD: 1450 });
  });
  it("applies fixed discounts for monthly-or-longer coupons without going negative", () => {
    expect(computeMrr([sub({ discounts: [{ coupon: { amount_off: 1000 } }] })])).toEqual({ USD: 1900 });
    expect(computeMrr([sub({ discounts: [{ coupon: { amount_off: 999999 } }] })])).toEqual({ USD: 0 });
  });
  it("applies a fixed coupon to the billing-interval amount before normalising to a month", () => {
    // $120/year with $24 off the yearly invoice is $96/year, so $8/month, not $10 - $24.
    const yearly = sub({ items: { data: [item(12000, "year")] }, discounts: [{ coupon: { amount_off: 2400 } }] });
    expect(computeMrr([yearly])).toEqual({ USD: 800 });
    const quarterly = sub({ items: { data: [item(3000, "month", 3)] }, discounts: [{ coupon: { amount_off: 300 } }] });
    expect(computeMrr([quarterly])).toEqual({ USD: 900 });
  });
  it("applies a fixed coupon once per invoice, not once per item", () => {
    const two = sub({ items: { data: [item(1000, "year"), item(2000, "year")] }, discounts: [{ coupon: { amount_off: 600 } }] });
    expect(computeMrr([two])).toEqual({ USD: 200 });
  });
  it("ignores a repeating coupon whose discount has ended", () => {
    const now = 1_800_000_000;
    const ended = { end: now - 1, coupon: { percent_off: 50, duration: "repeating" } };
    const running = { end: now + 1000, coupon: { percent_off: 50, duration: "repeating" } };
    expect(computeMrr([sub({ discounts: [ended] })], now)).toEqual({ USD: 2900 });
    expect(computeMrr([sub({ discounts: [running] })], now)).toEqual({ USD: 1450 });
  });
  it("skips metered/tiered items with no unit_amount instead of guessing", () => {
    expect(computeMrr([sub({ items: { data: [item(0, "month", 1, 1, { unit_amount: null })] } })])).toEqual({});
  });
  it("keeps currencies separate", () => {
    const eur = sub({ items: { data: [{ quantity: 1, price: { unit_amount: 1000, currency: "eur", recurring: { interval: "month", interval_count: 1 } } }] } });
    expect(computeMrr([sub(), eur])).toEqual({ USD: 2900, EUR: 1000 });
  });
  it("ignores junk", () => {
    expect(computeMrr([null, {}, { status: "active" }] as unknown[])).toEqual({});
  });
});

describe("fetchActiveSubscriptions", () => {
  it("paginates and sends the bearer key", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "sub_1" }], has_more: true }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "sub_2" }], has_more: false }));
    const out = await fetchActiveSubscriptions("rk_test_x", f as unknown as typeof fetch);
    expect(out).toHaveLength(2);
    expect(String(f.mock.calls[1]?.[0])).toContain("starting_after=sub_1");
    expect((f.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: "Bearer rk_test_x" });
  });
  it("throws a useful error on Stripe failure without leaking the key", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(fetchActiveSubscriptions("rk_test_secret", f as unknown as typeof fetch)).rejects.toThrow(/401/);
    await expect(fetchActiveSubscriptions("rk_test_secret", f as unknown as typeof fetch)).rejects.not.toThrow(/rk_test_secret/);
  });
});

const snap = (date: string, mrrMinor: number): Snapshot => ({ date, mrrMinor, currency: "USD" });

describe("recordSnapshot", () => {
  it("upserts the latest value for a day and keeps order", () => {
    let h = recordSnapshot([], snap("2026-11-01", 100));
    h = recordSnapshot(h, snap("2026-11-01", 120));
    h = recordSnapshot(h, snap("2026-10-31", 90));
    expect(h.map((s) => s.mrrMinor)).toEqual([90, 120]);
  });
  it("keeps at most 400 days", () => {
    let h: Snapshot[] = [];
    for (let i = 0; i < 450; i++) h = recordSnapshot(h, snap(new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), i));
    expect(h).toHaveLength(400);
  });
});

describe("streakDays", () => {
  const h = (...pairs: [string, number][]) => pairs.map(([d, v]) => snap(d, v));
  it("counts consecutive days where MRR beat the day before, including today", () => {
    expect(streakDays(h(["2026-10-29", 100], ["2026-10-30", 110], ["2026-10-31", 120], ["2026-11-01", 130]), "2026-11-01")).toBe(3);
  });
  it("does not break the streak just because today has not beaten yesterday yet", () => {
    expect(streakDays(h(["2026-10-30", 100], ["2026-10-31", 110], ["2026-11-01", 110]), "2026-11-01")).toBe(1);
  });
  it("breaks on a dip and on a missing day", () => {
    expect(streakDays(h(["2026-10-29", 100], ["2026-10-30", 90], ["2026-10-31", 95], ["2026-11-01", 99]), "2026-11-01")).toBe(2);
    expect(streakDays(h(["2026-10-28", 100], ["2026-10-30", 110], ["2026-10-31", 120]), "2026-10-31")).toBe(1);
  });
  it("is 0 with no history, a single day, or a stale history", () => {
    expect(streakDays([], "2026-11-01")).toBe(0);
    expect(streakDays(h(["2026-11-01", 100]), "2026-11-01")).toBe(0);
    expect(streakDays(h(["2026-10-01", 100], ["2026-10-02", 110]), "2026-11-01")).toBe(0);
  });
});

describe("mrrSummary", () => {
  it("reports the latest MRR, today's change, streak and goal", () => {
    const s = mrrSummary(
      [snap("2026-10-31", 100_000), snap("2026-11-01", 124_700)],
      "2026-11-01",
      200_000,
    );
    expect(s).toMatchObject({ mrrMinor: 124_700, currency: "USD", todayDeltaMinor: 24_700, streakDays: 1, goalMinor: 200_000, goalPercentLeft: 38 });
    expect(s?.formatted).toBe("$1,247.00");
  });
  it("returns null with no data", () => {
    expect(mrrSummary([], "2026-11-01")).toBeNull();
  });
  it("clamps goal percentages", () => {
    expect(mrrSummary([snap("2026-11-01", 300_000)], "2026-11-01", 200_000)?.goalPercentLeft).toBe(0);
  });
});
