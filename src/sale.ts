import type { Sale, SaleKind, Tier } from "./types.ts";

const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

function decimals(currency: string): number {
  const c = currency.toUpperCase();
  return ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
}

export function majorUnits(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** decimals(currency);
}

export function formatAmount(amountMinor: number, currency: string): string {
  const major = majorUnits(amountMinor, currency);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(major);
  } catch {
    return `${major.toFixed(decimals(currency))} ${currency.toUpperCase()}`;
  }
}

export function tierFor(
  amountMinor: number,
  currency: string,
  thresholds: { bigAt: number; hugeAt: number },
): Tier {
  const major = majorUnits(amountMinor, currency);
  if (major >= thresholds.hugeAt) return "huge";
  if (major >= thresholds.bigAt) return "big";
  return "normal";
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
/** Stripe ids appear either as a string or, when expanded, as an object with an `id`. */
const idOf = (v: unknown): string | undefined => (isObj(v) ? str(v.id) : str(v));

/**
 * Turns a Stripe event into a Sale, or null if it is not something to celebrate.
 *
 * - One-time payments come from `checkout.session.completed` (mode=payment, paid).
 * - Subscriptions come from `invoice.paid`, which covers first payment and renewals.
 * - `payment_intent.succeeded` is deliberately ignored: it duplicates both of the above.
 */
export function eventToSale(event: unknown): Sale | null {
  if (!isObj(event) || !isObj(event.data) || !isObj(event.data.object)) return null;
  const obj = event.data.object;
  const created = typeof event.created === "number" ? event.created : Math.floor(Date.now() / 1000);
  const livemode = event.livemode === true;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (obj.mode !== "payment" || obj.payment_status !== "paid") return null;
      if (typeof obj.amount_total !== "number" || obj.amount_total <= 0) return null;
      const currency = str(obj.currency);
      if (!currency) return null;
      const details = isObj(obj.customer_details) ? obj.customer_details : {};
      return {
        dedupeKey: idOf(obj.payment_intent) ?? str(obj.id) ?? str(event.id) ?? `evt_${created}`,
        amountMinor: obj.amount_total,
        currency: currency.toUpperCase(),
        kind: "one_time",
        livemode,
        customerName: str(details.name),
        customerEmail: str(details.email),
        created,
      };
    }
    case "invoice.paid": {
      if (typeof obj.amount_paid !== "number" || obj.amount_paid <= 0) return null;
      const currency = str(obj.currency);
      if (!currency) return null;
      const kind: SaleKind = obj.billing_reason === "subscription_cycle" ? "renewal" : "new_subscription";
      const lines = isObj(obj.lines) && Array.isArray(obj.lines.data) ? obj.lines.data : [];
      const first = lines[0];
      return {
        dedupeKey: idOf(obj.payment_intent) ?? str(obj.id) ?? str(event.id) ?? `evt_${created}`,
        amountMinor: obj.amount_paid,
        currency: currency.toUpperCase(),
        kind,
        livemode,
        customerName: str(obj.customer_name),
        customerEmail: str(obj.customer_email),
        description: isObj(first) ? str(first.description) : undefined,
        created,
      };
    }
    default:
      return null;
  }
}
