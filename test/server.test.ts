import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createGongServer } from "../src/server.ts";

const SECRET = "whsec_test";
const servers: ReturnType<typeof createGongServer>[] = [];

async function start(token?: string, dataDir?: string, env: Record<string, string> = {}) {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  const server = createGongServer({
    config: loadConfig({ STRIPE_WEBHOOK_SECRET: SECRET, DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/a", GONG_SALE_MILESTONES: "none", ...env }),
    token,
    dataDir,
    fetch: fetchMock as unknown as typeof fetch,
  });
  await new Promise<void>((r) => server.listen(0, r));
  servers.push(server);
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, fetchMock };
}

afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

function signedSale(id = "1", dollars = 49) {
  const body = JSON.stringify({
    id: `evt_${id}`, type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), livemode: true,
    data: { object: { id: `cs_${id}`, mode: "payment", payment_status: "paid", amount_total: dollars * 100, currency: "usd", payment_intent: `pi_${id}`,
      customer_details: { name: "Ada", email: "ada@example.com" } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  return { body, headers: { "stripe-signature": `t=${t},v1=${sig}` } };
}

describe("server", () => {
  it("serves /health and 404s the rest", async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/health`)).text()).toBe("ok");
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("verifies the raw body end to end and forwards to Discord", async () => {
    const { base, fetchMock } = await start();
    const { body, headers } = signedSale();
    const res = await fetch(`${base}/webhook`, { method: "POST", headers, body });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const bad = await fetch(`${base}/webhook`, { method: "POST", headers, body: body + " " });
    expect(bad.status).toBe(400);
  });

  it("serves the gong page", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/gong`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("MRR Gong");
  });

  it("pushes sales to browsers over SSE", async () => {
    const { base } = await start();
    const events = await fetch(`${base}/events`);
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // ": connected"

    const { body, headers } = signedSale("2", 500);
    await fetch(`${base}/webhook`, { method: "POST", headers, body });
    const { value } = await reader.read();
    const line = decoder.decode(value).split("\n").find((l) => l.startsWith("data: "))!;
    expect(JSON.parse(line.slice(6))).toMatchObject({ amount: "$500.00", tier: "big", label: "Ada" });
    await reader.cancel();
  });

  it("protects the gong page and stream with a token when configured", async () => {
    const { base } = await start("s3cret");
    expect((await fetch(`${base}/gong`)).status).toBe(401);
    expect((await fetch(`${base}/events?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/gong?token=s3cret`)).status).toBe(200);
    // the Stripe webhook is authenticated by signature, not the token
    const { body, headers } = signedSale("3");
    expect((await fetch(`${base}/webhook`, { method: "POST", headers, body })).status).toBe(200);
  });

  it("refuses oversized webhook bodies", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/webhook`, { method: "POST", body: "x".repeat(1_100_000) });
    expect(res.status).toBe(413);
  });
});

describe("durable dedupe", () => {
  it("does not double-post when the server restarts between two identical deliveries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mrrgong-server-"));
    try {
      const { body, headers } = signedSale("restart");
      const first = await start(undefined, dir);
      expect(await (await fetch(`${first.base}/webhook`, { method: "POST", headers, body })).text()).toBe("gong");
      expect(first.fetchMock).toHaveBeenCalledTimes(1);
      const s = servers.pop()!;
      s.closeAllConnections();
      await new Promise((r) => s.close(r));

      const second = await start(undefined, dir);
      expect(await (await fetch(`${second.base}/webhook`, { method: "POST", headers, body })).text()).toBe("duplicate");
      expect(second.fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("sale milestones", () => {
  const post = (base: string, id: string) => {
    const { body, headers } = signedSale(id);
    return fetch(`${base}/webhook`, { method: "POST", headers, body });
  };
  const posted = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));

  it("announces the first sale to Discord and over SSE, once", async () => {
    const { base, fetchMock } = await start(undefined, undefined, { GONG_SALE_MILESTONES: "1,3" });
    const sse = await fetch(`${base}/events`);
    const reader = sse.body!.getReader();
    let seen = "";
    const pump = (async () => {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        seen += dec.decode(value);
      }
    })();

    await post(base, "m1");
    await post(base, "m2");
    expect(fetchMock).toHaveBeenCalledTimes(3); // sale, First sale!, sale
    const titles = posted(fetchMock).map((p) => p.embeds?.[0]?.title ?? "");
    expect(titles.filter((t: string) => t.includes("First sale"))).toHaveLength(1);
    await vi.waitFor(() => expect(seen).toContain("event: milestone"));
    expect(seen).toContain("First sale!");
    await reader.cancel();
    await pump;
  });

  it("keeps the sale count across a restart when a data dir is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mrrgong-milestones-"));
    try {
      const first = await start(undefined, dir, { GONG_SALE_MILESTONES: "1,2" });
      await post(first.base, "r1");
      expect(first.fetchMock).toHaveBeenCalledTimes(2);
      const s = servers.pop()!;
      s.closeAllConnections();
      await new Promise((r) => s.close(r));

      const second = await start(undefined, dir, { GONG_SALE_MILESTONES: "1,2" });
      await post(second.base, "r2");
      const titles = posted(second.fetchMock).map((p) => p.embeds?.[0]?.title ?? "");
      expect(titles.some((t: string) => t.includes("2nd sale"))).toBe(true);
      expect(titles.some((t: string) => t.includes("First sale"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
