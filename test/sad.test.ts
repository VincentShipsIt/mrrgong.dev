import { describe, expect, it } from "vitest";
import { eventToSad } from "../src/sad.ts";

const refund = (over: Record<string, unknown> = {}) => ({
  id: "evt_r", type: "charge.refunded", created: 1_700_000_000, livemode: true,
  data: { object: { id: "ch_1", amount_refunded: 2900, currency: "usd", ...over } },
});
const canceled = (over: Record<string, unknown> = {}) => ({
  id: "evt_c", type: "customer.subscription.deleted", created: 1_700_000_000, livemode: false,
  data: { object: { id: "sub_1", status: "canceled", discounts: [],
    items: { data: [{ quantity: 2, price: { unit_amount: 1500, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] }, ...over } },
});

describe("eventToSad", () => {
  it("maps a refund using the cumulative refunded amount", () => {
    expect(eventToSad(refund())).toEqual({
      dedupeKey: "refund:ch_1:2900", type: "refund", amountMinor: 2900, currency: "USD", livemode: true, created: 1_700_000_000,
    });
  });
  it("keys partial then full refunds differently so both are announced once", () => {
    expect(eventToSad(refund({ amount_refunded: 1000 }))?.dedupeKey).not.toBe(eventToSad(refund())?.dedupeKey);
  });
  it("ignores zero or invalid refunds", () => {
    expect(eventToSad(refund({ amount_refunded: 0 }))).toBeNull();
    expect(eventToSad(refund({ amount_refunded: "lots" }))).toBeNull();
    expect(eventToSad(refund({ currency: undefined }))).toBeNull();
  });
  it("maps a canceled subscription to the monthly revenue lost", () => {
    expect(eventToSad(canceled())).toMatchObject({
      dedupeKey: "cancel:sub_1", type: "cancel", amountMinor: 3000, currency: "USD", livemode: false,
    });
  });
  it("ignores cancellations with no recurring revenue", () => {
    expect(eventToSad(canceled({ items: { data: [] } }))).toBeNull();
  });
  it("ignores other events and junk", () => {
    expect(eventToSad({ type: "invoice.paid", data: { object: {} } })).toBeNull();
    expect(eventToSad(null)).toBeNull();
    expect(eventToSad({ type: "charge.refunded" })).toBeNull();
  });
});
