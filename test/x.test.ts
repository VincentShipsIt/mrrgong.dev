import { describe, expect, it, vi } from "vitest";
import { oauth1Header, oauth1Signature, percentEncode, xSink } from "../src/x.ts";
import type { GongEvent, Message, Sale } from "../src/types.ts";

describe("OAuth 1.0a", () => {
  // Inputs shaped like X's "Creating a signature" example. The expected value was computed by an
  // independent reference (Python hmac + urllib, written separately from this code), not by this module.
  const doc = {
    method: "POST",
    url: "https://api.twitter.com/1.1/statuses/update.json",
    params: { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
    consumerKey: "xvz1evFS4wEEPTGEFPHBog",
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EmZaAj0wsj0OTE",
    tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    timestamp: "1318622958",
  };
  it("percent-encodes per RFC 3986", () => {
    expect(percentEncode("Ladies + Gentlemen!*'()")).toBe("Ladies%20%2B%20Gentlemen%21%2A%27%28%29");
    expect(percentEncode("a-b_c.d~e")).toBe("a-b_c.d~e");
  });
  it("matches an independent reference implementation", async () => {
    expect(await oauth1Signature(doc)).toBe("drAJJSsvAvYyTZpA+kw3c3aIwks=");
  });
  it("builds an Authorization header with sorted, quoted, encoded oauth params", async () => {
    const header = await oauth1Header({ ...doc, params: {} });
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toMatch(/oauth_signature="[^"]+%[0-9A-F]{2}[^"]*"|oauth_signature="[A-Za-z0-9%]+"/);
    expect(header).not.toContain("kAcSOqF21Fu85e7"); // secrets never go on the wire
  });
});

const creds = { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessSecret: "as" };
const sale: Sale = { dedupeKey: "k", amountMinor: 25_000, currency: "USD", kind: "one_time", livemode: true, created: 1 };
const saleEvent = (msg: Partial<Message> = {}): GongEvent => ({
  type: "sale", sale, tier: "big",
  message: { title: "T", tier: "big", tone: "sale", publicText: "🔔🔔 GONG GONG! $250.00 sale", ...msg },
});
const milestoneEvent: GongEvent = {
  type: "milestone",
  milestone: { id: "m", kind: "mrr", text: "MRR just crossed $1,000." },
  message: { title: "T", tier: "big", tone: "milestone", publicText: "🔔 MRR just crossed $1,000." },
};

describe("xSink", () => {
  const ok = () => vi.fn(async () => Response.json({ data: { id: "1" } }, { status: 201 }));

  it("posts milestones with a signed request and nothing but the public text", async () => {
    const f = ok();
    await xSink({ creds, fetch: f as unknown as typeof fetch })(milestoneEvent);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(String(init.body))).toEqual({ text: "🔔 MRR just crossed $1,000." });
    expect((init.headers as Record<string, string>).authorization).toMatch(/^OAuth /);
  });
  it("does not post ordinary sales by default", async () => {
    const f = ok();
    await xSink({ creds, fetch: f as unknown as typeof fetch })(saleEvent());
    expect(f).not.toHaveBeenCalled();
  });
  it("posts sales at or above the opt-in threshold only", async () => {
    const f = ok();
    const sink = xSink({ creds, postAllOverMajor: 200, fetch: f as unknown as typeof fetch });
    await sink(saleEvent());
    expect(f).toHaveBeenCalledTimes(1);
    f.mockClear();
    await xSink({ creds, postAllOverMajor: 300, fetch: f as unknown as typeof fetch })(saleEvent());
    expect(f).not.toHaveBeenCalled();
  });
  it("never posts sad events or messages without public text", async () => {
    const f = ok();
    const sink = xSink({ creds, postAllOverMajor: 1, fetch: f as unknown as typeof fetch });
    await sink({ type: "sad", sad: { dedupeKey: "k", type: "refund", amountMinor: 1, currency: "USD", livemode: true, created: 1 }, message: { title: "T", tier: "normal", tone: "sad", publicText: "leak" } });
    await sink(saleEvent({ publicText: undefined }));
    expect(f).not.toHaveBeenCalled();
  });
  it("truncates to 280 characters", async () => {
    const f = ok();
    await xSink({ creds, fetch: f as unknown as typeof fetch })({ ...milestoneEvent, message: { ...milestoneEvent.message, publicText: "x".repeat(400) } });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).text).toHaveLength(280);
  });
  it("throws a useful error without leaking credentials when X rejects", async () => {
    const f = vi.fn(async () => new Response("denied", { status: 403 }));
    const p = xSink({ creds, fetch: f as unknown as typeof fetch })(milestoneEvent);
    await expect(p).rejects.toThrow(/403/);
    await expect(p).rejects.not.toThrow(/cs|as/);
  });
});
