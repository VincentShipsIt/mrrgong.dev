import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createHandler } from "../src/handler.ts";
import { createGong } from "../src/handler.ts";
import { createPicker } from "../src/copy.ts";
import { memoryState } from "../src/state.ts";
import type { DedupeStore, Sink } from "../src/types.ts";

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

function setup(envOver: Record<string, string> = {}, extra: Sink[] = [], opts: { state?: ReturnType<typeof memoryState>; writer?: (c: unknown) => Promise<string | null> } = {}) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
  const config = loadConfig({
    STRIPE_WEBHOOK_SECRET: SECRET, DISCORD_WEBHOOK_URL: DISCORD, SLACK_WEBHOOK_URL: SLACK, GONG_MILESTONES: "false", ...envOver,
  });
  const gong = createGong({
    config, fetch: fetchMock as unknown as typeof fetch, state: opts.state ?? memoryState(), extraSinks: extra,
    writer: opts.writer as never, pick: createPicker(() => 0),
  });
  return { handle: gong.handle, gong, fetchMock, config };
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
    expect(extra).toHaveBeenCalledWith(expect.objectContaining({ type: "sale", tier: "huge", sale: expect.objectContaining({ amountMinor: 250_000 }) }));
  });

  it("returns 200 without doing anything when no sinks are configured at all", async () => {
    const { handle } = setup({ DISCORD_WEBHOOK_URL: "", SLACK_WEBHOOK_URL: "" });
    expect((await handle(signed(event()))).status).toBe(200);
  });
});



const sentTo = (fetchMock: ReturnType<typeof setup>["fetchMock"], url: string) =>
  fetchMock.mock.calls.filter((c) => String(c[0]) === url).map((c) => JSON.parse(String(c[1]?.body)));

describe("modes and AI line", () => {
  it("uses the mode's tagline in the message", async () => {
    const { handle, fetchMock } = setup({ GONG_MODE: "indie", SLACK_WEBHOOK_URL: "" });
    await handle(signed(event({ amount_total: 1000 })));
    expect(sentTo(fetchMock, DISCORD)[0].embeds[0].description).toContain("MRR go brrr.");
  });
  it("prefers the AI writer's line, and falls back when it returns null", async () => {
    const writer = vi.fn(async () => "Freshly written.");
    const a = setup({ SLACK_WEBHOOK_URL: "", GONG_MODE: "indie" }, [], { writer });
    await a.handle(signed(event()));
    expect(sentTo(a.fetchMock, DISCORD)[0].embeds[0].description).toContain("Freshly written.");
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ tier: "huge", kind: "one_time", amountMajor: 2500, mode: "indie" }));
    expect(JSON.stringify(writer.mock.calls)).not.toMatch(/Ada|example\.com/);

    const b = setup({ SLACK_WEBHOOK_URL: "", GONG_MODE: "indie" }, [], { writer: async () => null });
    await b.handle(signed(event()));
    expect(sentTo(b.fetchMock, DISCORD)[0].embeds[0].description).toContain("Ada");
  });
});

describe("milestones", () => {
  it("announces the first sale after the sale itself", async () => {
    const { handle, fetchMock } = setup({ GONG_MILESTONES: "true", SLACK_WEBHOOK_URL: "" });
    expect((await handle(signed(event()))).status).toBe(200);
    const titles = sentTo(fetchMock, DISCORD).map((p) => p.embeds[0].title);
    expect(titles[0]).toContain("GONGGGG");
    expect(titles[1]).toContain("MILESTONE! First sale ever");
  });
  it("does not repeat the first-sale milestone for the second sale", async () => {
    const { handle, fetchMock } = setup({ GONG_MILESTONES: "true", SLACK_WEBHOOK_URL: "" });
    await handle(signed(event()));
    await handle(signed(event({ id: "cs_2", payment_intent: "pi_2" })));
    expect(sentTo(fetchMock, DISCORD).filter((p) => p.embeds[0].title.includes("MILESTONE"))).toHaveLength(1);
  });
  it("announces MRR milestones fed from the watcher, once", async () => {
    const { gong, fetchMock } = setup({ GONG_MILESTONES: "true", SLACK_WEBHOOK_URL: "" });
    const reading = (mrrMinor: number) => ({ mrrMinor, currency: "USD", formatted: "", todayDeltaMinor: 0, streakDays: 0 });
    await gong.onMrr(reading(5_000));
    await gong.onMrr(reading(120_000));
    await gong.onMrr(reading(120_000));
    const titles = sentTo(fetchMock, DISCORD).map((p) => p.embeds[0].title);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain("MRR just crossed $1,000.");
  });
  it("stays silent when milestones are off, and survives a broken state store", async () => {
    const off = setup({ GONG_MILESTONES: "false", SLACK_WEBHOOK_URL: "" });
    await off.gong.onMrr({ mrrMinor: 999_999, currency: "USD", formatted: "", todayDeltaMinor: 0, streakDays: 0 });
    expect(off.fetchMock).not.toHaveBeenCalled();

    const broken = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); } };
    const s = setup({ GONG_MILESTONES: "true", SLACK_WEBHOOK_URL: "" }, [], { state: broken as never });
    expect((await s.handle(signed(event()))).status).toBe(200); // the sale still counts as celebrated
  });
});

describe("sad gong", () => {
  const refund = JSON.stringify({
    id: "evt_ref", type: "charge.refunded", created: Math.floor(Date.now() / 1000), livemode: true,
    data: { object: { id: "ch_1", amount_refunded: 2900, currency: "usd" } },
  });
  it("is off by default", async () => {
    const { handle, fetchMock } = setup();
    expect((await handle(signed(refund))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("announces refunds once when enabled, privately", async () => {
    const { handle, fetchMock } = setup({ GONG_SAD: "true", SLACK_WEBHOOK_URL: "" });
    expect((await handle(signed(refund))).status).toBe(200);
    await handle(signed(refund));
    const posts = sentTo(fetchMock, DISCORD);
    expect(posts).toHaveLength(1);
    expect(posts[0].embeds[0].title).toContain("Refund: $29.00");
  });
  it("returns 500 for retry when every sink fails", async () => {
    const { handle, fetchMock } = setup({ GONG_SAD: "true", SLACK_WEBHOOK_URL: "" });
    fetchMock.mockImplementationOnce(async () => new Response("no", { status: 500 }));
    expect((await handle(signed(refund))).status).toBe(500);
  });
});

describe("other channels", () => {
  it("posts to ntfy as JSON", async () => {
    const { handle, fetchMock } = setup({ DISCORD_WEBHOOK_URL: "", SLACK_WEBHOOK_URL: "", NTFY_TOPIC: "my-gong" });
    await handle(signed(event()));
    const [call] = sentTo(fetchMock, "https://ntfy.sh");
    expect(call).toMatchObject({ topic: "my-gong", priority: 5 });
    expect(call.title).toContain("GONGGGG");
  });
  it("posts milestones (customer-free) to X, and nothing else by default", async () => {
    const { handle, fetchMock } = setup({
      GONG_MILESTONES: "true", DISCORD_WEBHOOK_URL: "", SLACK_WEBHOOK_URL: "",
      X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d",
    });
    await handle(signed(event()));
    const tweets = sentTo(fetchMock, "https://api.x.com/2/tweets");
    expect(tweets).toHaveLength(1);
    expect(tweets[0].text).toBe("🔔 First sale ever. Someone paid for your thing.");
  });
});
