import { describe, expect, it, vi } from "vitest";
import { oauth1Header, oauth1Signature, percentEncode, xSink } from "../src/x.ts";
import type { Sale } from "../src/types.ts";

describe("OAuth 1.0a", () => {
  // Inputs shaped like X's "Creating a signature" example. The expected value was computed by an
  // independent reference (Python hmac + urllib), not by this module.
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

  it("builds an Authorization header and never puts secrets on the wire", async () => {
    const header = await oauth1Header({ ...doc, params: {} });
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toMatch(/oauth_signature="[A-Za-z0-9%]+"/);
    expect(header).not.toContain("kAcSOqF21Fu85e7");
    expect(header).not.toContain("LswwdoUaIvS8");
  });
});

const creds = { apiKey: "ck", apiSecret: "cs-secret", accessToken: "at", accessSecret: "as-secret" };
const sale = (over: Partial<Sale> = {}): Sale => ({
  dedupeKey: "k", amountMinor: 25_000, currency: "USD", kind: "one_time", livemode: true,
  customerName: "Ada Lovelace", customerEmail: "ada@example.com", description: "secret plan", created: 1, ...over,
});
const ok = () => vi.fn(async () => Response.json({ data: { id: "1" } }, { status: 201 }));
type Call = [string, RequestInit];

describe("xSink", () => {
  it("is public, so sad events never reach it", () => {
    expect(xSink({ creds }).public).toBe(true);
  });

  it("posts milestones with a signed request and just the title", async () => {
    const f = ok();
    await xSink({ creds, fetch: f as unknown as typeof fetch }).milestone?.({ kind: "mrr", title: "MRR just crossed $1,000" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as Call;
    expect(url).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(String(init.body))).toEqual({ text: "🔔 MRR just crossed $1,000" });
    expect((init.headers as Record<string, string>).authorization).toMatch(/^OAuth /);
  });

  it("does not post ordinary sales by default", async () => {
    const f = ok();
    await xSink({ creds, fetch: f as unknown as typeof fetch })(sale(), "big");
    expect(f).not.toHaveBeenCalled();
  });

  it("posts live sales at or above the opt-in threshold, amount only, never customer text", async () => {
    const f = ok();
    await xSink({ creds, postAllOverMajor: 200, fetch: f as unknown as typeof fetch })(sale(), "big");
    expect(f).toHaveBeenCalledTimes(1);
    const body = String((f.mock.calls[0] as unknown as Call)[1].body);
    expect(body).toContain("$250.00");
    expect(body).not.toMatch(/Ada|ada@|secret plan/);
    f.mockClear();
    await xSink({ creds, postAllOverMajor: 300, fetch: f as unknown as typeof fetch })(sale(), "big");
    expect(f).not.toHaveBeenCalled();
  });

  it("never posts test-mode sales", async () => {
    const f = ok();
    await xSink({ creds, postAllOverMajor: 1, fetch: f as unknown as typeof fetch })(sale({ livemode: false }), "big");
    expect(f).not.toHaveBeenCalled();
  });

  it("truncates to 280 characters", async () => {
    const f = ok();
    await xSink({ creds, fetch: f as unknown as typeof fetch }).milestone?.({ kind: "mrr", title: "x".repeat(400) });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as Call)[1].body)).text).toHaveLength(280);
  });

  it("throws without leaking credentials when X rejects", async () => {
    const f = vi.fn(async () => new Response("denied", { status: 403 }));
    const err = await xSink({ creds, fetch: f as unknown as typeof fetch }).milestone?.({ kind: "mrr", title: "t" }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/X responded 403/);
    expect((err as Error).message).not.toMatch(/secret/);
  });
});
