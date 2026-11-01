/**
 * `npm run simulate [amountInDollars]`: sends a correctly signed fake sale to a
 * running salesgong so you can hear the gong without touching Stripe.
 */
import { createHmac } from "node:crypto";

const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error("STRIPE_WEBHOOK_SECRET is required");
  process.exit(1);
}
const target = process.env.GONG_URL ?? `http://localhost:${process.env.PORT ?? 8787}/webhook`;
const dollars = Number(process.argv[2] ?? 49);
const now = Math.floor(Date.now() / 1000);
const id = Math.random().toString(36).slice(2, 10);

const body = JSON.stringify({
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
