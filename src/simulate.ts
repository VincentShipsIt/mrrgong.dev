/**
 * `npm run simulate [amountInDollars] [sale|subscription|renewal|refund|cancel]`, or
 * `npm run simulate -- --mrr 5000` / `--sales 100` to rehearse a milestone (counters stay untouched):
 * sends a correctly signed fake Stripe event to a running mrrgong so you can hear the gong
 * without touching Stripe. Events are test-mode (never public, never counted for milestones) unless SIM_LIVE=1.
 */
import { createHmac } from "node:crypto";

const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error("STRIPE_WEBHOOK_SECRET is required");
  process.exit(1);
}
const target = process.env.GONG_URL ?? `http://localhost:${process.env.PORT ?? 8787}/webhook`;
const args = process.argv.slice(2);
const flag = (name: string): number | undefined => {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const n = Number(args[at + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${name} needs a positive number, e.g. ${name} 100`);
    process.exit(1);
  }
  return n;
};
const mrrPreview = flag("--mrr");
const salesPreview = flag("--sales");
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const dollars = Number(positional[0] ?? 49);
const now = Math.floor(Date.now() / 1000);
const id = Math.random().toString(36).slice(2, 10);

const kind = positional[1] ?? "sale";
const cents = Math.round(dollars * 100);
const base = { id: `evt_sim_${id}`, created: now, livemode: process.env.SIM_LIVE === "1" };
const price = { unit_amount: cents, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
const payloads: Record<string, unknown> = {
  sale: {
    ...base, type: "checkout.session.completed",
    data: { object: { id: `cs_sim_${id}`, mode: "payment", payment_status: "paid", amount_total: cents, currency: "usd", payment_intent: `pi_sim_${id}`, customer_details: { name: "Ada Lovelace", email: "ada@example.com" } } },
  },
  subscription: {
    ...base, type: "invoice.paid",
    data: { object: { id: `in_sim_${id}`, amount_paid: cents, currency: "usd", billing_reason: "subscription_create", customer_name: "Ada Lovelace", customer_email: "ada@example.com", payment_intent: `pi_sim_${id}`, lines: { data: [{ description: "Pro plan" }] } } },
  },
  renewal: {
    ...base, type: "invoice.paid",
    data: { object: { id: `in_sim_${id}`, amount_paid: cents, currency: "usd", billing_reason: "subscription_cycle", customer_name: "Ada Lovelace", payment_intent: `pi_sim_${id}` } },
  },
  refund: { ...base, type: "charge.refunded", data: { object: { id: `ch_sim_${id}`, amount_refunded: cents, currency: "usd" } } },
  cancel: {
    ...base, type: "customer.subscription.deleted",
    data: { object: { id: `sub_sim_${id}`, status: "canceled", items: { data: [{ quantity: 1, price }] } } },
  },
};
const preview = mrrPreview !== undefined
  ? { kind: "mrr", amount: mrrPreview, currency: process.env.GONG_CURRENCY ?? "usd" }
  : salesPreview !== undefined ? { kind: "sales", count: Math.round(salesPreview) } : undefined;
const payload = preview
  ? { id: `evt_sim_${id}`, type: "mrrgong.simulate.milestone", created: now, livemode: false, data: { object: preview } }
  : payloads[kind];
if (!payload) {
  console.error(`unknown event "${kind}", use one of: ${Object.keys(payloads).join(", ")}`);
  process.exit(1);
}
const body = JSON.stringify(payload);
const sig = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
const res = await fetch(target, { method: "POST", headers: { "stripe-signature": `t=${now},v1=${sig}` }, body });
console.log(`${res.status} ${await res.text()}`);
