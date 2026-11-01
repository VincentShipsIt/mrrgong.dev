import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker.ts";

const env = { STRIPE_WEBHOOK_SECRET: "whsec_w", DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/a" };

describe("worker", () => {
  it("serves health and 404s other paths", async () => {
    expect(await (await worker.fetch(new Request("https://x/health"), env)).text()).toBe("ok");
    expect((await worker.fetch(new Request("https://x/other"), env)).status).toBe(404);
  });

  it("reports bad config instead of crashing", async () => {
    const res = await worker.fetch(new Request("https://x/webhook", { method: "POST" }), {});
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/STRIPE_WEBHOOK_SECRET/);
  });

  it("celebrates a signed sale", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    const body = JSON.stringify({
      id: "evt_w", type: "checkout.session.completed", created: 1, livemode: true,
      data: { object: { id: "cs_w", mode: "payment", payment_status: "paid", amount_total: 1000, currency: "usd", payment_intent: "pi_w" } },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex");
    const res = await worker.fetch(new Request("https://x/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body }), env);
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
