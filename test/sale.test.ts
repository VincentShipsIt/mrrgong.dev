import { describe, expect, it } from "vitest";
import { eventToSad, eventToSale, formatAmount, tierFor, majorUnits } from "../src/sale.ts";

const checkout = (over: Record<string, unknown> = {}) => ({
  id: "evt_1",
  type: "checkout.session.completed",
  created: 1_700_000_000,
  livemode: true,
  data: {
    object: {
      id: "cs_1",
      mode: "payment",
      payment_status: "paid",
      amount_total: 4900,
      currency: "usd",
      payment_intent: "pi_1",
      customer_details: { name: "Ada Lovelace", email: "ada@example.com" },
      ...over,
    },
  },
});

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "evt_2",
  type: "invoice.paid",
  created: 1_700_000_000,
  livemode: true,
  data: {
    object: {
      id: "in_1",
      amount_paid: 1900,
      currency: "usd",
      billing_reason: "subscription_create",
      customer_name: "Grace",
      customer_email: "grace@example.com",
      payment_intent: "pi_2",
      lines: { data: [{ description: "Pro plan" }] },
      ...over,
    },
  },
});

describe("eventToSale", () => {
  it("maps a paid one-time checkout session", () => {
    expect(eventToSale(checkout())).toMatchObject({
      dedupeKey: "pi_1",
      amountMinor: 4900,
      currency: "USD",
      kind: "one_time",
      customerName: "Ada Lovelace",
      customerEmail: "ada@example.com",
      livemode: true,
    });
  });

  it("ignores unpaid checkout sessions (async payment methods)", () => {
    expect(eventToSale(checkout({ payment_status: "unpaid" }))).toBeNull();
  });

  it("ignores subscription-mode checkouts; invoice.paid covers them", () => {
    expect(eventToSale(checkout({ mode: "subscription" }))).toBeNull();
  });

  it("celebrates async payments that settle later", () => {
    const e = { ...checkout(), type: "checkout.session.async_payment_succeeded" };
    expect(eventToSale(e)?.amountMinor).toBe(4900);
  });

  it("maps a new subscription invoice", () => {
    expect(eventToSale(invoice())).toMatchObject({
      kind: "new_subscription",
      dedupeKey: "pi_2",
      description: "Pro plan",
      customerName: "Grace",
    });
  });

  it("maps a renewal", () => {
    expect(eventToSale(invoice({ billing_reason: "subscription_cycle" }))?.kind).toBe("renewal");
  });

  it("ignores zero-amount invoices (trials, 100% coupons)", () => {
    expect(eventToSale(invoice({ amount_paid: 0 }))).toBeNull();
  });

  it("falls back to the invoice id when there is no payment intent", () => {
    expect(eventToSale(invoice({ payment_intent: null }))?.dedupeKey).toBe("in_1");
  });

  it("accepts an expanded payment_intent object", () => {
    expect(eventToSale(checkout({ payment_intent: { id: "pi_x" } }))?.dedupeKey).toBe("pi_x");
  });

  it("falls back to the event id when nothing else identifies the payment", () => {
    expect(eventToSale(checkout({ payment_intent: null }))?.dedupeKey).toBe("cs_1");
  });

  it.each(["charge.refunded", "customer.created", "payment_intent.succeeded"])(
    "ignores %s",
    (type) => {
      expect(eventToSale({ ...checkout(), type })).toBeNull();
    },
  );

  it("returns null for junk input", () => {
    expect(eventToSale(null)).toBeNull();
    expect(eventToSale({})).toBeNull();
    expect(eventToSale({ type: "invoice.paid" })).toBeNull();
    expect(eventToSale(checkout({ amount_total: "lots" }))).toBeNull();
  });

  it("flags test-mode events", () => {
    expect(eventToSale({ ...checkout(), livemode: false })?.livemode).toBe(false);
  });
});

describe("amounts", () => {
  it("handles zero-decimal currencies", () => {
    expect(majorUnits(500, "JPY")).toBe(500);
    expect(majorUnits(500, "USD")).toBe(5);
  });
  it("handles three-decimal currencies", () => {
    expect(majorUnits(1000, "KWD")).toBe(1);
  });
  it("formats money", () => {
    expect(formatAmount(4900, "USD")).toBe("$49.00");
    expect(formatAmount(500, "JPY")).toMatch(/500/);
  });
  it("does not throw on an unknown currency code", () => {
    expect(formatAmount(1234, "XXXX")).toContain("12.34");
  });
});

describe("tierFor", () => {
  const cfg = { bigAt: 100, hugeAt: 1000 };
  it("picks tiers by major-unit amount", () => {
    expect(tierFor(9_999, "USD", cfg)).toBe("normal");
    expect(tierFor(10_000, "USD", cfg)).toBe("big");
    expect(tierFor(99_999, "USD", cfg)).toBe("big");
    expect(tierFor(100_000, "USD", cfg)).toBe("huge");
  });
  it("respects zero-decimal currencies", () => {
    expect(tierFor(100, "JPY", cfg)).toBe("big");
  });
});

describe("eventToSale: sad events", () => {
  const refund = (over: Record<string, unknown> = {}) => ({
    id: "evt_r",
    type: "charge.refunded",
    created: 1_700_000_000,
    livemode: true,
    data: {
      object: {
        id: "ch_1",
        amount: 4900,
        amount_refunded: 4900,
        currency: "usd",
        billing_details: { name: "Ada Lovelace", email: "ada@example.com" },
        refunds: { data: [{ id: "re_1", amount: 4900 }] },
        ...over,
      },
    },
  });
  const cancel = (over: Record<string, unknown> = {}) => ({
    id: "evt_c",
    type: "customer.subscription.deleted",
    created: 1_700_000_000,
    livemode: true,
    data: {
      object: {
        id: "sub_1",
        currency: "usd",
        items: { data: [{ quantity: 2, price: { unit_amount: 1500, currency: "usd" } }] },
        ...over,
      },
    },
  });

  it("is ignored by eventToSale: sad events are opt-in", () => {
    expect(eventToSale(refund())).toBeNull();
    expect(eventToSale(cancel())).toBeNull();
  });

  it("maps a refund to the amount of the latest refund", () => {
    expect(eventToSad(refund({ amount_refunded: 6000, refunds: { data: [{ id: "re_2", amount: 1100 }] } }))).toMatchObject({
      kind: "refund",
      amountMinor: 1100,
      currency: "USD",
      dedupeKey: "refund:re_2",
      customerName: "Ada Lovelace",
      customerEmail: "ada@example.com",
    });
  });
  it("falls back to the cumulative refunded amount when Stripe omits the refund list", () => {
    expect(eventToSad(refund({ refunds: undefined }))).toMatchObject({ amountMinor: 4900, dedupeKey: "refund:ch_1:4900" });
  });
  it("ignores a refund of nothing", () => {
    expect(eventToSad(refund({ amount_refunded: 0, refunds: undefined }))).toBeNull();
  });

  it("maps a canceled subscription to what it was billing per interval", () => {
    expect(eventToSad(cancel())).toMatchObject({ kind: "cancellation", amountMinor: 3000, currency: "USD", dedupeKey: "cancel:sub_1" });
  });
  it("ignores a canceled subscription with no flat price", () => {
    expect(eventToSad(cancel({ items: { data: [{ price: { unit_amount: null, currency: "usd" } }] } }))).toBeNull();
  });

  it("ignores everything else", () => {
    expect(eventToSad(checkout())).toBeNull();
    expect(eventToSad({ type: "charge.refunded" })).toBeNull();
    expect(eventToSad(null)).toBeNull();
  });
});
