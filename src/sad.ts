import { computeMrr } from "./mrr.ts";
import type { SadEvent } from "./types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Refunds and canceled subscriptions. Only announced when GONG_SAD=true. */
export function eventToSad(event: unknown): SadEvent | null {
  if (!isObj(event) || !isObj(event.data) || !isObj(event.data.object)) return null;
  const obj = event.data.object;
  const created = typeof event.created === "number" ? event.created : Math.floor(Date.now() / 1000);
  const livemode = event.livemode === true;

  if (event.type === "charge.refunded") {
    const currency = str(obj.currency);
    if (typeof obj.amount_refunded !== "number" || obj.amount_refunded <= 0 || !currency) return null;
    return {
      // amount_refunded is cumulative, so a later full refund is announced separately from a partial one.
      dedupeKey: `refund:${str(obj.id) ?? str(event.id) ?? created}:${obj.amount_refunded}`,
      type: "refund",
      amountMinor: obj.amount_refunded,
      currency: currency.toUpperCase(),
      livemode,
      created,
    };
  }

  if (event.type === "customer.subscription.deleted") {
    // computeMrr only counts active subscriptions, so present this one as if it still were.
    const lost = Object.entries(computeMrr([{ ...obj, status: "active" }])).sort((a, b) => b[1] - a[1])[0];
    if (!lost || lost[1] <= 0) return null;
    return {
      dedupeKey: `cancel:${str(obj.id) ?? str(event.id) ?? created}`,
      type: "cancel",
      amountMinor: lost[1],
      currency: lost[0],
      livemode,
      created,
    };
  }
  return null;
}
