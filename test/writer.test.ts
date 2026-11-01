import { describe, expect, it, vi } from "vitest";
import { buildPrompt, createWriter, sanitizeLine } from "../src/writer.ts";

const ctx = { tier: "big" as const, kind: "new_subscription" as const, amountMajor: 240, currency: "USD", mode: "indie" as const };

describe("buildPrompt", () => {
  it("contains only the amount, tier, kind and mode, never customer fields", () => {
    // Even if a caller passes extra (customer) fields by mistake, they cannot reach the prompt.
    const p = buildPrompt({ ...ctx, customerName: "Ada Lovelace", customerEmail: "ada@example.com", description: "Secret plan" } as typeof ctx);
    expect(p).not.toMatch(/Ada|Lovelace|example\.com|Secret/);
    expect(p).toContain("$240");
    expect(p).toContain("big");
    expect(p).toContain("new subscriber");
    expect(p).toContain("indie hacker");
  });
});

describe("sanitizeLine", () => {
  it("keeps a single short line and strips quotes, mentions, links and markdown", () => {
    expect(sanitizeLine('"MRR go brrr, @everyone <!channel> https://x.co **bold**"\nsecond line')).toBe("MRR go brrr, everyone !channel bold");
  });
  it("caps the length", () => {
    expect(sanitizeLine("a".repeat(500))!.length).toBeLessThanOrEqual(140);
  });
  it("returns null for empty output", () => {
    expect(sanitizeLine("   ")).toBeNull();
    expect(sanitizeLine("@@@")).toBeNull();
  });
});

describe("createWriter", () => {
  const reply = (text: string, status = 200) => vi.fn(async () => Response.json({ content: [{ type: "text", text }] }, { status }));

  it("calls the Anthropic Messages API with the key and returns a sanitised line", async () => {
    const f = reply("Rent is paid. @everyone");
    const line = await createWriter({ apiKey: "sk-ant-x", model: "claude-haiku-5-5", fetch: f as unknown as typeof fetch })(ctx);
    expect(line).toBe("Rent is paid. everyone");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-ant-x", "anthropic-version": "2023-06-01" });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 60 });
    expect(JSON.stringify(body)).not.toContain("sk-ant-x");
  });
  it("returns null on API errors, bad shapes, thrown fetches and timeouts, so the caller falls back", async () => {
    const make = (f: typeof fetch, timeoutMs?: number) => createWriter({ apiKey: "k", model: "m", fetch: f, timeoutMs });
    expect(await make(reply("x", 500) as unknown as typeof fetch)(ctx)).toBeNull();
    expect(await make((async () => Response.json({ nope: 1 })) as unknown as typeof fetch)(ctx)).toBeNull();
    expect(await make((async () => { throw new Error("down"); }) as unknown as typeof fetch)(ctx)).toBeNull();
    const slow = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    expect(await make(slow, 20)(ctx)).toBeNull();
  });
});
