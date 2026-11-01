import { describe, expect, it, vi } from "vitest";
import { ntfyMilestonePayload, ntfySalePayload, ntfySink } from "../src/ntfy.ts";
import type { Sale } from "../src/types.ts";

const sale = (over: Partial<Sale> = {}): Sale => ({
  dedupeKey: "k", amountMinor: 4900, currency: "USD", kind: "one_time", livemode: true,
  customerName: "Ada Lovelace", customerEmail: "ada@example.com", description: "Pro plan", created: 1, ...over,
});

describe("ntfy payloads", () => {
  it("sets priority by tier", () => {
    expect(ntfySalePayload("t", sale(), "normal", "masked")).toMatchObject({ topic: "t", priority: 3, tags: ["bell"] });
    expect(ntfySalePayload("t", sale(), "big", "masked").priority).toBe(4);
    expect(ntfySalePayload("t", sale(), "huge", "masked").priority).toBe(5);
  });

  it("puts the headline in the title and the customer in the message, per visibility", () => {
    const p = ntfySalePayload("t", sale(), "normal", "masked");
    expect(p.title).toContain("$49.00");
    expect(p.message).toBe("Ada Lovelace\nPro plan");
    expect(ntfySalePayload("t", sale(), "normal", "none").message).toBe("Pro plan");
    expect(ntfySalePayload("t", sale({ description: undefined }), "normal", "none")).not.toHaveProperty("message");
  });

  it("keeps refunds quiet and tagged sad", () => {
    expect(ntfySalePayload("t", sale({ kind: "refund" }), "huge", "masked")).toMatchObject({ priority: 2, tags: ["droplet"] });
  });

  it("makes milestones high priority", () => {
    expect(ntfyMilestonePayload("t", { kind: "first_sale", title: "First sale!" })).toEqual({
      topic: "t", title: "🔔 First sale!", priority: 4, tags: ["tada"],
    });
  });
});

describe("ntfySink", () => {
  it("publishes JSON to the server root and trims trailing slashes", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    const sink = ntfySink("https://ntfy.example.com/", "topic", "masked", f as unknown as typeof fetch);
    await sink(sale(), "normal");
    await sink.milestone?.({ kind: "sales", title: "10 sales" });
    expect(f).toHaveBeenCalledTimes(2);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe("https://ntfy.example.com");
    expect(JSON.parse(String(calls[0]?.[1].body)).topic).toBe("topic");
    expect(JSON.parse(String(calls[1]?.[1].body)).title).toBe("🔔 10 sales");
  });

  it("is not public (it may carry refunds) and surfaces failures", async () => {
    const f = vi.fn(async () => new Response("no", { status: 500 }));
    const sink = ntfySink("https://ntfy.sh", "t", "masked", f as unknown as typeof fetch);
    expect(sink.public).toBeUndefined();
    await expect(sink(sale(), "normal")).rejects.toThrow(/ntfy responded 500/);
  });
});
