import { describe, expect, it } from "vitest";
import { customerLabel, discordPayload, headline, maskEmail, slackPayload } from "../src/format.ts";
import type { Sale } from "../src/types.ts";

const sale = (over: Partial<Sale> = {}): Sale => ({
  dedupeKey: "pi_1",
  amountMinor: 4900,
  currency: "USD",
  kind: "one_time",
  livemode: true,
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
  created: 1_700_000_000,
  ...over,
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("ada@example.com")).toBe("a**@example.com");
  });
  it("copes with garbage", () => {
    expect(maskEmail("nope")).toBe("n***");
  });
});

describe("customerLabel", () => {
  it("shows the name when allowed", () => {
    expect(customerLabel(sale(), "full")).toBe("Ada Lovelace (ada@example.com)");
    expect(customerLabel(sale(), "masked")).toBe("Ada Lovelace");
  });
  it("masks the email when there is no name", () => {
    expect(customerLabel(sale({ customerName: undefined }), "masked")).toBe("a**@example.com");
    expect(customerLabel(sale({ customerName: undefined }), "full")).toBe("ada@example.com");
  });
  it("hides everything on request", () => {
    expect(customerLabel(sale(), "none")).toBeUndefined();
  });
  it("is undefined when Stripe gave us nothing", () => {
    expect(customerLabel(sale({ customerName: undefined, customerEmail: undefined }), "full")).toBeUndefined();
  });
});

describe("headline", () => {
  it("scales the gong with the tier", () => {
    expect(headline(sale(), "normal")).toContain("GONG!");
    expect(headline(sale(), "big")).toContain("GONG GONG!");
    expect(headline(sale(), "huge")).toContain("GONGGGG");
  });
  it("labels test-mode events", () => {
    expect(headline(sale({ livemode: false }), "normal")).toContain("[TEST]");
    expect(headline(sale(), "normal")).not.toContain("[TEST]");
  });
  it("includes the amount and the kind", () => {
    expect(headline(sale(), "normal")).toContain("$49.00");
    expect(headline(sale({ kind: "new_subscription" }), "normal")).toContain("new subscriber");
    expect(headline(sale({ kind: "renewal" }), "normal")).toContain("renewal");
  });
});

describe("discordPayload", () => {
  it("builds an embed with a tier color and no mentions allowed", () => {
    const p = discordPayload(sale(), "big", "masked");
    expect(p.username).toBe("MRR Gong");
    expect(p.allowed_mentions).toEqual({ parse: [] });
    expect(p.embeds).toHaveLength(1);
    expect(p.embeds[0]?.description).toContain("Ada Lovelace");
    expect(p.embeds[0]?.timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(discordPayload(sale(), "normal", "masked").embeds[0]?.color).not.toBe(p.embeds[0]?.color);
  });
  it("neutralises @everyone coming from customer-controlled fields", () => {
    const p = discordPayload(sale({ customerName: "@everyone" }), "normal", "masked");
    expect(p.allowed_mentions).toEqual({ parse: [] });
  });
});

describe("slackPayload", () => {
  it("builds blocks with a plain-text fallback", () => {
    const p = slackPayload(sale(), "huge", "masked");
    expect(p.text).toContain("$49.00");
    expect(p.blocks[0]?.type).toBe("section");
  });
  it("escapes Slack control characters in customer-controlled text", () => {
    const p = slackPayload(sale({ customerName: "<!channel> & <b>" }), "normal", "masked");
    const text = JSON.stringify(p);
    expect(text).not.toContain("<!channel>");
    expect(text).toContain("&lt;!channel&gt; &amp; &lt;b&gt;");
  });
});

describe("sad gong", () => {
  const refund = sale({ kind: "refund", amountMinor: 1100 });
  const cancel = sale({ kind: "cancellation", amountMinor: 2900, customerName: undefined, customerEmail: undefined });

  it("has a muted headline with no gong", () => {
    expect(headline(refund, "normal")).toBe("😔 $11.00 refunded");
    expect(headline(cancel, "normal")).toBe("😔 $29.00 subscription canceled");
    expect(headline(refund, "normal")).not.toContain("GONG");
    expect(headline({ ...refund, livemode: false }, "normal")).toBe("[TEST] 😔 $11.00 refunded");
  });
  it("is grey on Discord, and still never pings anyone", () => {
    const p = discordPayload(refund, "normal", "masked");
    expect(p.embeds[0]?.color).toBe(0x808080);
    expect(p.allowed_mentions).toEqual({ parse: [] });
  });
  it("is plain in Slack and escapes customer text", () => {
    const p = slackPayload({ ...refund, customerName: "<!channel>" }, "normal", "masked");
    expect(p.blocks[0]?.text.text).toContain("&lt;!channel&gt;");
    expect(p.text).toBe("😔 $11.00 refunded");
  });
});
