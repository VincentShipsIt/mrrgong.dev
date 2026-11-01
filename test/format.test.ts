import { describe, expect, it } from "vitest";
import { createPicker } from "../src/copy.ts";
import {
  customerLabel, discordPayload, escapeSlack, headline, maskEmail, ntfyPayload, renderMilestone, renderSad, renderSale, slackPayload,
} from "../src/format.ts";
import type { Message, Sale } from "../src/types.ts";

const sale = (over: Partial<Sale> = {}): Sale => ({
  dedupeKey: "pi_1", amountMinor: 4900, currency: "USD", kind: "one_time", livemode: true,
  customerName: "Ada Lovelace", customerEmail: "ada@example.com", created: 1_700_000_000, ...over,
});
const calm = { mode: "calm" as const, customer: "masked" as const };

describe("maskEmail / customerLabel", () => {
  it("masks emails", () => {
    expect(maskEmail("ada@example.com")).toBe("a**@example.com");
    expect(maskEmail("nope")).toBe("n***");
  });
  it("respects visibility", () => {
    expect(customerLabel(sale(), "full")).toBe("Ada Lovelace (ada@example.com)");
    expect(customerLabel(sale(), "masked")).toBe("Ada Lovelace");
    expect(customerLabel(sale({ customerName: undefined }), "masked")).toBe("a**@example.com");
    expect(customerLabel(sale({ customerName: undefined }), "full")).toBe("ada@example.com");
    expect(customerLabel(sale(), "none")).toBeUndefined();
    expect(customerLabel(sale({ customerName: undefined, customerEmail: undefined }), "full")).toBeUndefined();
  });
});

describe("headline", () => {
  it("scales the gong with the tier and labels test mode", () => {
    expect(headline(sale(), "normal")).toContain("GONG!");
    expect(headline(sale(), "big")).toContain("GONG GONG!");
    expect(headline(sale(), "huge")).toContain("GONGGGG");
    expect(headline(sale({ livemode: false }), "normal")).toContain("[TEST]");
    expect(headline(sale(), "normal")).not.toContain("[TEST]");
  });
  it("includes the amount and the kind", () => {
    expect(headline(sale({ kind: "new_subscription" }), "normal")).toContain("$49.00 new subscriber");
    expect(headline(sale({ kind: "renewal" }), "normal")).toContain("renewal");
  });
});

describe("renderSale", () => {
  it("calm mode: title plus customer only", () => {
    const m = renderSale(sale(), "big", calm);
    expect(m.title).toContain("$49.00");
    expect(m.body).toBe("Ada Lovelace");
    expect(m.tone).toBe("sale");
  });
  it("other modes add a tagline from their copy", () => {
    const m = renderSale(sale(), "normal", { mode: "indie", customer: "masked", pick: createPicker(() => 0) });
    expect(m.body?.split("\n")[0]).toBe("MRR go brrr.");
    expect(m.body).toContain("Ada Lovelace");
  });
  it("an AI line replaces the canned tagline", () => {
    const m = renderSale(sale(), "normal", { mode: "indie", customer: "none", line: "Fresh line." });
    expect(m.body).toBe("Fresh line.");
  });
  it("hides the customer on request and joins the description", () => {
    const m = renderSale(sale({ description: "Pro plan" }), "normal", { ...calm, customer: "none" });
    expect(m.body).toBe("Pro plan");
    expect(renderSale(sale({ customerName: undefined, customerEmail: undefined }), "normal", calm).body).toBeUndefined();
  });
  it("public text never carries customer data, and test-mode sales are never public", () => {
    const m = renderSale(sale({ description: "Secret plan" }), "big", { ...calm, customer: "full" });
    expect(m.publicText).toBe("🔔🔔 GONG GONG! $49.00 sale");
    expect(m.publicText).not.toMatch(/Ada|example|Secret/);
    expect(renderSale(sale({ livemode: false }), "big", calm).publicText).toBeUndefined();
  });
});

describe("renderMilestone / renderSad", () => {
  it("milestones are public and customer-free", () => {
    const m = renderMilestone({ id: "mrr:1", kind: "mrr", text: "MRR just crossed $1,000." }, { mode: "indie", pick: createPicker(() => 0) });
    expect(m.title).toContain("MILESTONE! MRR just crossed $1,000.");
    expect(m.publicText).toBe("🔔 MRR just crossed $1,000.");
    expect(m.tone).toBe("milestone");
    expect(m.body).toBeTruthy();
    expect(renderMilestone({ id: "x", kind: "first_sale", text: "First sale." }, { mode: "calm" }).body).toBeUndefined();
  });
  it("sad events are private", () => {
    const refund = renderSad({ dedupeKey: "k", type: "refund", amountMinor: 2900, currency: "USD", livemode: true, created: 1 }, { mode: "calm" });
    expect(refund.title).toContain("Refund: $29.00");
    expect(refund.publicText).toBeUndefined();
    const cancel = renderSad({ dedupeKey: "k", type: "cancel", amountMinor: 2900, currency: "USD", livemode: false, created: 1 }, { mode: "broker" });
    expect(cancel.title).toContain("[TEST]");
    expect(cancel.title).toContain("Subscription canceled: $29.00 MRR lost");
    expect(cancel.body).toBeTruthy();
  });
});

const msg = (over: Partial<Message> = {}): Message => ({ title: "T", body: "B", tier: "normal", tone: "sale", ...over });

describe("channel payloads", () => {
  it("discord: embed with tone colours and no mentions allowed", () => {
    const p = discordPayload(msg({ body: "@everyone" }));
    expect(p.allowed_mentions).toEqual({ parse: [] });
    expect(p.embeds[0]).toMatchObject({ title: "T", description: "@everyone" });
    const colors = new Set([
      discordPayload(msg()).embeds[0]?.color, discordPayload(msg({ tier: "big" })).embeds[0]?.color,
      discordPayload(msg({ tier: "huge" })).embeds[0]?.color, discordPayload(msg({ tone: "milestone" })).embeds[0]?.color,
      discordPayload(msg({ tone: "sad" })).embeds[0]?.color,
    ]);
    expect(colors.size).toBe(5);
  });
  it("slack: fallback text, blocks, and escaped control characters", () => {
    expect(escapeSlack("<!channel> & <b>")).toBe("&lt;!channel&gt; &amp; &lt;b&gt;");
    const p = slackPayload(msg({ body: "<!channel>" }));
    expect(p.text).toBe("T");
    expect(JSON.stringify(p)).not.toContain("<!channel>");
    expect(slackPayload(msg({ body: undefined })).blocks[0]?.text.text).toBe("*T*");
  });
  it("ntfy: JSON publish with priority by tier and tag by tone", () => {
    expect(ntfyPayload("topic", msg({ tier: "huge" }))).toMatchObject({ topic: "topic", title: "T", message: "B", priority: 5, tags: ["bell"] });
    expect(ntfyPayload("t", msg({ tone: "sad" }))).toMatchObject({ priority: 2, tags: ["droplet"] });
    expect(ntfyPayload("t", msg({ tone: "milestone", body: undefined }))).toMatchObject({ message: "T", tags: ["tada"] });
  });
});
