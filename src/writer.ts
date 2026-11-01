import { SaleKindLabel } from "./labels.ts";
import type { Mode, SaleKind, Tier } from "./types.ts";

export interface WriterContext {
  tier: Tier;
  kind: SaleKind;
  amountMajor: number;
  currency: string;
  mode: Mode;
}

export type LineWriter = (ctx: WriterContext) => Promise<string | null>;

const FLAVOUR: Record<Mode, string> = {
  calm: "warm and understated",
  indie: "an indie hacker in-joke (build in public, MRR, side projects, shipping)",
  broker: "an old-school trading-floor sales boast (closing deals, phones ringing, the board)",
};

/**
 * Deliberately takes no customer fields: the model only ever sees how big the sale was.
 * That also means a customer cannot inject instructions through a name or description.
 */
export function buildPrompt(ctx: WriterContext): string {
  const sizes: Record<Tier, string> = { normal: "a normal-sized", big: "a big", huge: "a huge" };
  const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(ctx.amountMajor);
  return [
    `Write ONE short celebratory line (under 12 words) for ${sizes[ctx.tier]} payment: $${amount} ${ctx.currency}, a ${SaleKindLabel[ctx.kind]}.`,
    `Tone: ${FLAVOUR[ctx.mode]}. Funny, never mean. No emoji, no hashtags, no names, no quotes, no @mentions.`,
    "Reply with the line only.",
  ].join(" ");
}

/** One plain line, no mentions, links or markdown, at most 140 characters. */
export function sanitizeLine(text: string): string | null {
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  const clean = first
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#"“”<>@]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140)
    .trim();
  return /[A-Za-z0-9]/.test(clean) ? clean : null;
}

export interface WriterOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createWriter(options: WriterOptions): LineWriter {
  const fetchImpl = options.fetch ?? fetch;
  return async (ctx) => {
    try {
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: options.model, max_tokens: 60, messages: [{ role: "user", content: buildPrompt(ctx) }] }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      const block = (body as { content?: { type?: string; text?: unknown }[] })?.content?.[0];
      return block?.type === "text" && typeof block.text === "string" ? sanitizeLine(block.text) : null;
    } catch {
      return null; // any failure means "use the canned line"
    }
  };
}
