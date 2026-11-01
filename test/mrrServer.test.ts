import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createGongServer } from "../src/server.ts";

const servers: ReturnType<typeof createGongServer>[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

const subs = (n: number) =>
  Response.json({
    has_more: false,
    data: Array.from({ length: n }, (_, i) => ({
      id: `sub_${i}`, status: "active", discounts: [],
      items: { data: [{ quantity: 1, price: { unit_amount: 10_000, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] },
    })),
  });

async function start(extraEnv: Record<string, string> = {}, seed?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "mrrgong-"));
  const historyFile = join(dir, "history.json");
  if (seed) await writeFile(historyFile, JSON.stringify(seed));
  let n = 3;
  const fetchMock = vi.fn(async (input: string | URL | Request) =>
    String(input).startsWith("https://api.stripe.com") ? subs(n) : new Response(null, { status: 204 }));
  const server = createGongServer({
    stateFile: join(mkdtempSync(join(tmpdir(), "gong-")), "state.json"),
    config: loadConfig({ STRIPE_WEBHOOK_SECRET: "whsec_t", STRIPE_API_KEY: "rk_test_x", MRR_GOAL: "1000", ...extraEnv }),
    fetch: fetchMock as unknown as typeof fetch,
    historyFile,
    now: () => new Date("2026-11-01T12:00:00Z"),
  });
  await new Promise<void>((r) => server.listen(0, r));
  servers.push(server);
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, historyFile, fetchMock, setSubs: (x: number) => (n = x) };
}

describe("GET /mrr", () => {
  it("returns MRR, delta, streak and goal, and persists today's snapshot", async () => {
    const { base, historyFile } = await start({}, [{ date: "2026-10-31", mrrMinor: 20_000, currency: "USD" }]);
    const res = await fetch(`${base}/mrr`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      mrrMinor: 30_000, currency: "USD", formatted: "$300.00", todayDeltaMinor: 10_000, streakDays: 1, goalPercentLeft: 70,
    });
    const saved = JSON.parse(await readFile(historyFile, "utf8"));
    expect(saved.at(-1)).toEqual({ date: "2026-11-01", mrrMinor: 30_000, currency: "USD" });
  });

  it("is 404 when no Stripe API key is configured", async () => {
    const { base } = await start({ STRIPE_API_KEY: "" });
    expect((await fetch(`${base}/mrr`)).status).toBe(404);
  });

  it("is protected by the token when one is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mrrgong-"));
    const server = createGongServer({
    stateFile: join(mkdtempSync(join(tmpdir(), "gong-")), "state.json"),
      config: loadConfig({ STRIPE_WEBHOOK_SECRET: "whsec_t", STRIPE_API_KEY: "rk_test_x" }),
      token: "s3cret",
      fetch: (async () => subs(1)) as unknown as typeof fetch,
      historyFile: join(dir, "h.json"),
    });
    await new Promise<void>((r) => server.listen(0, r));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/mrr`)).status).toBe(401);
    expect((await fetch(`${base}/mrr?token=s3cret`)).status).toBe(200);
  });

  it("survives a corrupt history file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mrrgong-"));
    const historyFile = join(dir, "h.json");
    await writeFile(historyFile, "{not json");
    const server = createGongServer({
    stateFile: join(mkdtempSync(join(tmpdir(), "gong-")), "state.json"),
      config: loadConfig({ STRIPE_WEBHOOK_SECRET: "whsec_t", STRIPE_API_KEY: "rk_test_x" }),
      fetch: (async () => subs(2)) as unknown as typeof fetch,
      historyFile,
    });
    await new Promise<void>((r) => server.listen(0, r));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await (await fetch(`${base}/mrr`)).json()).mrrMinor).toBe(20_000);
  });

  it("reports 503 instead of crashing when Stripe is unreachable and there is no data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mrrgong-"));
    const server = createGongServer({
    stateFile: join(mkdtempSync(join(tmpdir(), "gong-")), "state.json"),
      config: loadConfig({ STRIPE_WEBHOOK_SECRET: "whsec_t", STRIPE_API_KEY: "rk_test_x" }),
      fetch: (async () => new Response("no", { status: 401 })) as unknown as typeof fetch,
      historyFile: join(dir, "h.json"),
    });
    await new Promise<void>((r) => server.listen(0, r));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/mrr`)).status).toBe(503);
  });
});

describe("MRR milestones and the key's mode", () => {
  const DISCORD = "https://discord.com/api/webhooks/1/abc";
  async function startSeeded(apiKey: string) {
    const dir = await mkdtemp(join(tmpdir(), "mrrgong-"));
    const stateFile = join(dir, "state.json");
    // Pretend a first reading was already recorded, so this one counts as a crossing.
    await writeFile(stateFile, JSON.stringify({ "ms:init:mrr:USD": { v: "1" } }));
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith("https://api.stripe.com") ? subs(15) : new Response(null, { status: 204 }));
    const server = createGongServer({
      stateFile,
      config: loadConfig({ STRIPE_WEBHOOK_SECRET: "whsec_t", STRIPE_API_KEY: apiKey, DISCORD_WEBHOOK_URL: DISCORD }),
      fetch: fetchMock as unknown as typeof fetch,
      historyFile: join(dir, "h.json"),
      now: () => new Date("2026-11-01T12:00:00Z"),
    });
    await new Promise<void>((r) => server.listen(0, r));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, fetchMock };
  }
  const discordCalls = (m: { mock: { calls: unknown[][] } }) => m.mock.calls.filter((c) => String(c[0]) === DISCORD);

  it("announces an MRR milestone from a live key", async () => {
    const { base, fetchMock } = await startSeeded("rk_live_x");
    await vi.waitFor(() => expect(discordCalls(fetchMock)).toHaveLength(1));
    expect(String((discordCalls(fetchMock)[0]![1] as RequestInit).body)).toContain("MRR just crossed $1,000.");
    expect((await fetch(`${base}/mrr`)).status).toBe(200);
  });

  it("never lets a test-mode key burn real milestones, but still serves /mrr", async () => {
    const { base, fetchMock } = await startSeeded("rk_test_x");
    const res = await fetch(`${base}/mrr`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mrrMinor: 150_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(discordCalls(fetchMock)).toHaveLength(0);
  });
});
