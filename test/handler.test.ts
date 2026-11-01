import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createHandler, memoryDedupe } from "../src/handler.ts";
import { createMilestoneTracker, memoryMilestoneStore, type MilestoneTracker } from "../src/milestones.ts";
import type { Sink } from "../src/types.ts";

const SECRET = "whsec_test";
const DISCORD = "https://discord.com/api/webhooks/1/abc";
const SLACK = "https://hooks.slack.com/services/T/B/x";

const event = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    livemode: true,
    data: {
      object: {
        id: "cs_1", mode: "payment", payment_status: "paid", amount_total: 250_000, currency: "usd",
        payment_intent: "pi_1", customer_details: { name: "Ada", email: "ada@example.com" }, ...over,
      },
    },
  });

function signed(body: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return new Request("https://gong.test/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${t},v1=${sig}` },
    body,
  });
}

function setup(envOver: Record<string, string> = {}, extra: Sink[] = []) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
  const config = loadConfig({
    STRIPE_WEBHOOK_SECRET: SECRET, DISCORD_WEBHOOK_URL: DISCORD, SLACK_WEBHOOK_URL: SLACK, ...envOver,
  });
  const handle = createHandler({ config, fetch: fetchMock as unknown as typeof fetch, dedupe: memoryDedupe(), extraSinks: extra });
  return { handle, fetchMock };
}

describe("handler", () => {
  it("posts a huge-tier gong to both Discord and Slack", async () => {
    const { handle, fetchMock } = setup();
    const res = await handle(signed(event()));
    expect(res.status).toBe(200);
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).sort();
    expect(urls).toEqual([DISCORD, SLACK].sort());
    const discord = JSON.parse(String(fetchMock.mock.calls.find((c) => c[0] === DISCORD)?.[1]?.body));
    expect(discord.embeds[0].title).toContain("GONGGGG");
    expect(discord.embeds[0].title).toContain("$2,500.00");
  });

  it("only calls the sinks that are configured", async () => {
    const { handle, fetchMock } = setup({ SLACK_WEBHOOK_URL: "" });
    await handle(signed(event()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(DISCORD);
  });

  it("rejects bad signatures with 400 and celebrates nothing", async () => {
    const { handle, fetchMock } = setup();
    const res = await handle(signed(event(), "whsec_wrong"));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing signature header", async () => {
    const { handle } = setup();
    const res = await handle(new Request("https://gong.test/webhook", { method: "POST", body: event() }));
    expect(res.status).toBe(400);
  });

  it("rejects non-POST", async () => {
    const { handle } = setup();
    const res = await handle(new Request("https://gong.test/webhook"));
    expect(res.status).toBe(405);
  });

  it("answers 200 but stays quiet for events it does not care about", async () => {
    const { handle, fetchMock } = setup();
    const body = JSON.stringify({ id: "evt_9", type: "customer.created", data: { object: {} } });
    expect((await handle(signed(body))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 on signed-but-invalid JSON", async () => {
    const { handle } = setup();
    expect((await handle(signed("{not json"))).status).toBe(400);
  });

  it("does not celebrate the same payment twice (Stripe retries)", async () => {
    const { handle, fetchMock } = setup({ SLACK_WEBHOOK_URL: "" });
    await handle(signed(event()));
    await handle(signed(event()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips renewals when disabled", async () => {
    const { handle, fetchMock } = setup({ GONG_RENEWALS: "false" });
    const body = JSON.stringify({
      id: "evt_r", type: "invoice.paid", created: 1, livemode: true,
      data: { object: { id: "in_1", amount_paid: 1000, currency: "usd", billing_reason: "subscription_cycle" } },
    });
    expect((await handle(signed(body))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("succeeds if one sink fails and another works, and does not retry-loop Stripe", async () => {
    const { handle, fetchMock } = setup();
    fetchMock.mockImplementationOnce(async () => new Response("nope", { status: 500 }));
    const res = await handle(signed(event()));
    expect(res.status).toBe(200);
  });

  it("returns 500 when every sink fails so Stripe retries, and then celebrates on retry", async () => {
    const { handle, fetchMock } = setup({ SLACK_WEBHOOK_URL: "" });
    fetchMock.mockImplementationOnce(async () => new Response("nope", { status: 500 }));
    expect((await handle(signed(event()))).status).toBe(500);
    expect((await handle(signed(event()))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a thrown fetch as a failed sink, not a crash", async () => {
    const { handle, fetchMock } = setup({ SLACK_WEBHOOK_URL: "" });
    fetchMock.mockImplementationOnce(async () => { throw new Error("network down"); });
    expect((await handle(signed(event()))).status).toBe(500);
  });

  it("feeds extra sinks (the browser gong) too", async () => {
    const extra = vi.fn(async () => {});
    const { handle } = setup({ DISCORD_WEBHOOK_URL: "", SLACK_WEBHOOK_URL: "" }, [extra]);
    expect((await handle(signed(event()))).status).toBe(200);
    expect(extra).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 250_000 }), "huge");
  });

  it("returns 200 without doing anything when no sinks are configured at all", async () => {
    const { handle } = setup({ DISCORD_WEBHOOK_URL: "", SLACK_WEBHOOK_URL: "" });
    expect((await handle(signed(event()))).status).toBe(200);
  });

  describe("sad gong", () => {
    const refundEvent = (over: Record<string, unknown> = {}) =>
      JSON.stringify({
        id: "evt_r", type: "charge.refunded", created: Math.floor(Date.now() / 1000), livemode: true,
        data: { object: { id: "ch_1", amount: 4900, amount_refunded: 4900, currency: "usd", refunds: { data: [{ id: "re_1", amount: 4900 }] }, ...over } },
      });
    const cancelEvent = JSON.stringify({
      id: "evt_c", type: "customer.subscription.deleted", created: Math.floor(Date.now() / 1000), livemode: true,
      data: { object: { id: "sub_1", items: { data: [{ quantity: 1, price: { unit_amount: 2900, currency: "usd" } }] } } },
    });

    it("is off by default: refunds and cancellations are ignored", async () => {
      const { handle, fetchMock } = setup();
      expect(await (await handle(signed(refundEvent()))).text()).toBe("ignored");
      expect(await (await handle(signed(cancelEvent))).text()).toBe("ignored");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("posts a muted message to Discord and Slack when GONG_SAD=true", async () => {
      const { handle, fetchMock } = setup({ GONG_SAD: "true" });
      expect((await handle(signed(refundEvent()))).status).toBe(200);
      expect((await handle(signed(cancelEvent))).status).toBe(200);
      const bodies = fetchMock.mock.calls.map((c) => String(c[1]?.body));
      expect(bodies.some((b) => b.includes("$49.00 refunded"))).toBe(true);
      expect(bodies.some((b) => b.includes("$29.00 subscription canceled"))).toBe(true);
      expect(bodies.join("")).not.toContain("GONG");
    });

    it("does not announce the same refund twice", async () => {
      const { handle, fetchMock } = setup({ GONG_SAD: "true" });
      await handle(signed(refundEvent()));
      const calls = fetchMock.mock.calls.length;
      expect(await (await handle(signed(refundEvent()))).text()).toBe("duplicate");
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it("never reaches a public sink", async () => {
      const publicSink = Object.assign(vi.fn(async () => {}), { public: true });
      const privateSink = vi.fn(async () => {});
      const { handle } = setup({ GONG_SAD: "true" }, [publicSink, privateSink]);
      await handle(signed(refundEvent()));
      await handle(signed(cancelEvent));
      expect(publicSink).not.toHaveBeenCalled();
      expect(privateSink).toHaveBeenCalledTimes(2);
      // Sales still reach public sinks.
      await handle(signed(event()));
      expect(publicSink).toHaveBeenCalledTimes(1);
    });

    it("says nothing when only public sinks exist", async () => {
      const publicSink = Object.assign(vi.fn(async () => {}), { public: true });
      const { handle } = setup({ GONG_SAD: "true", DISCORD_WEBHOOK_URL: "", SLACK_WEBHOOK_URL: "" }, [publicSink]);
      expect(await (await handle(signed(refundEvent()))).text()).toBe("no sinks configured");
      expect(publicSink).not.toHaveBeenCalled();
    });
  });
});

describe("milestones in the handler", () => {
  const withTracker = (envOver: Record<string, string> = {}, tracker?: MilestoneTracker) => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
    const config = loadConfig({ STRIPE_WEBHOOK_SECRET: SECRET, DISCORD_WEBHOOK_URL: DISCORD, SLACK_WEBHOOK_URL: SLACK, ...envOver });
    const milestones = tracker ?? createMilestoneTracker(memoryMilestoneStore(), { mrr: [], sales: config.saleMilestones, initialSales: config.salesSoFar });
    const handle = createHandler({ config, fetch: fetchMock as unknown as typeof fetch, dedupe: memoryDedupe(), milestones });
    const titles = () =>
      fetchMock.mock.calls
        .filter((c) => c[0] === DISCORD)
        .map((c) => JSON.parse(String(c[1]?.body)).embeds?.[0]?.title as string);
    return { handle, fetchMock, titles };
  };
  const sale = (n: number, over: Record<string, unknown> = {}) => event({ id: `cs_${n}`, payment_intent: `pi_${n}`, ...over });
  const evt = (id: string, type: string, livemode: boolean, object: unknown) =>
    JSON.stringify({ id, type, created: Math.floor(Date.now() / 1000), livemode, data: { object } });

  it("announces the first sale and then the 10th, to every channel", async () => {
    const { handle, titles, fetchMock } = withTracker();
    for (let n = 1; n <= 10; n++) await handle(signed(JSON.stringify({ ...JSON.parse(sale(n)), id: `evt_${n}` })));
    expect(titles().filter((t) => t.startsWith("🔔🔔🔔 🎉"))).toEqual(["🔔🔔🔔 🎉 First sale!", "🔔🔔🔔 🎉 10th sale!"]);
    expect(fetchMock.mock.calls.filter((c) => c[0] === SLACK)).toHaveLength(12);
  });

  it("counts only live-mode sales", async () => {
    const { handle, titles } = withTracker();
    await handle(signed(JSON.stringify({ ...JSON.parse(sale(1)), livemode: false })));
    expect(titles().some((t) => t.includes("First sale"))).toBe(false);
  });

  it("does not count refunds as sales", async () => {
    const { handle, titles } = withTracker({ GONG_SAD: "true" });
    await handle(signed(evt("evt_r", "charge.refunded", true, { id: "ch_1", object: "charge", amount_refunded: 1100, currency: "usd", payment_intent: "pi_x", refunds: { data: [{ id: "re_1", amount: 1100 }] } })));
    expect(titles().some((t) => t.includes("First sale"))).toBe(false);
  });

  it("honours GONG_SALES_SO_FAR so an existing shop does not announce a first sale", async () => {
    const { handle, titles } = withTracker({ GONG_SALES_SO_FAR: "9" });
    await handle(signed(sale(1)));
    expect(titles().filter((t) => t.startsWith("🔔🔔🔔 🎉"))).toEqual(["🔔🔔🔔 🎉 10th sale!"]);
  });

  it("still gongs the sale when announcing a milestone fails, and when the store is broken", async () => {
    const broken = createMilestoneTracker(
      { load: async () => { throw new Error("disk full"); }, save: async () => {} },
      { mrr: [], sales: [1], initialSales: 0 },
    );
    const { handle } = withTracker({}, broken);
    expect((await handle(signed(sale(1)))).status).toBe(200);

    const f = vi.fn(async (url: string | URL | Request) => (String(url) === SLACK ? new Response("nope", { status: 500 }) : new Response(null, { status: 204 })));
    const config = loadConfig({ STRIPE_WEBHOOK_SECRET: SECRET, DISCORD_WEBHOOK_URL: DISCORD, SLACK_WEBHOOK_URL: SLACK });
    const h = createHandler({
      config, fetch: f as unknown as typeof fetch, dedupe: memoryDedupe(), log: () => {},
      milestones: createMilestoneTracker(memoryMilestoneStore(), { mrr: [], sales: [1], initialSales: 0 }),
    });
    expect((await h(signed(sale(2)))).status).toBe(200);
    expect(f.mock.calls.filter((c) => c[0] === DISCORD)).toHaveLength(2);
  });

  it("previews an MRR milestone from a signed simulated test event, without touching the counters", async () => {
    const { handle, titles } = withTracker();
    const res = await handle(signed(evt("evt_sim", "mrrgong.simulate.milestone", false, { kind: "mrr", amount: 5000, currency: "usd" })));
    expect(res.status).toBe(200);
    expect(titles()).toEqual(["🔔🔔🔔 🎉 MRR crossed $5,000.00!"]);
    await handle(signed(sale(1)));
    expect(titles().filter((t) => t.includes("First sale"))).toHaveLength(1);
  });

  it("ignores a live-mode simulate event and a bad signature", async () => {
    const { handle, fetchMock } = withTracker();
    await handle(signed(evt("evt_sim2", "mrrgong.simulate.milestone", true, { kind: "sales", count: 100 })));
    await handle(signed(evt("evt_sim3", "mrrgong.simulate.milestone", false, { kind: "sales", count: 100 }), "whsec_wrong"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
