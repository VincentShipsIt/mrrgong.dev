/**
 * `npm run simulate [amountInDollars]`: sends a correctly signed fake sale to a
 * running mrrgong so you can hear the gong without touching Stripe.
 *
 * `npm run simulate -- --mrr 5000` previews the "MRR crossed $5,000" milestone and
 * `-- --sales 100` the "100th sale" one, in every channel. Previews never touch the real
 * counters, so you can rehearse as often as you like.
 */
import { createHmac } from "node:crypto";

const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error("STRIPE_WEBHOOK_SECRET is required");
  process.exit(1);
}
const target = process.env.GONG_URL ?? `http://localhost:${process.env.PORT ?? 8787}/webhook`;
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${name} needs a positive number`);
    process.exit(1);
  }
  return n;
};
const mrr = flag("--mrr");
const sales = flag("--sales");
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const dollars = Number(positional[0] ?? 49);
const now = Math.floor(Date.now() / 1000);
const id = Math.random().toString(36).slice(2, 10);

const milestone = mrr !== undefined
  ? { kind: "mrr", amount: mrr, currency: process.env.GONG_CURRENCY ?? "usd" }
  : sales !== undefined ? { kind: "sales", count: Math.round(sales) } : undefined;

const body = JSON.stringify(milestone ? {
  id: `evt_sim_${id}`,
  type: "mrrgong.simulate.milestone",
  created: now,
  livemode: false,
  data: { object: milestone },
} : {
  id: `evt_sim_${id}`,
  type: "checkout.session.completed",
  created: now,
  livemode: false,
  data: {
    object: {
      id: `cs_sim_${id}`, mode: "payment", payment_status: "paid",
      amount_total: Math.round(dollars * 100), currency: "usd", payment_intent: `pi_sim_${id}`,
      customer_details: { name: "Ada Lovelace", email: "ada@example.com" },
    },
  },
});
const sig = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
const res = await fetch(target, { method: "POST", headers: { "stripe-signature": `t=${now},v1=${sig}` }, body });
console.log(`${res.status} ${await res.text()}`);
