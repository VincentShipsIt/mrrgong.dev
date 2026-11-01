import { LINES, MILESTONE_LINES, SAD_LINES, createPicker } from "./copy.ts";
import { SaleKindLabel } from "./labels.ts";
import { formatAmount } from "./sale.ts";
import type { CustomerVisibility, Message, Milestone, Mode, SadEvent, Sale, Tier } from "./types.ts";

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return `${email.slice(0, 1)}***`;
  return `${email.slice(0, 1)}${"*".repeat(Math.min(at - 1, 3) || 1)}${email.slice(at)}`;
}

export function customerLabel(sale: Sale, visibility: CustomerVisibility): string | undefined {
  if (visibility === "none") return undefined;
  const { customerName: name, customerEmail: email } = sale;
  if (visibility === "full") {
    if (name && email) return `${name} (${email})`;
    return name ?? email;
  }
  if (name) return name;
  return email ? maskEmail(email) : undefined;
}

const GONG: Record<Tier, string> = {
  normal: "🔔 GONG!",
  big: "🔔🔔 GONG GONG!",
  huge: "🔔🔔🔔 GONGGGG!!! 🎉",
};

export interface RenderOptions {
  mode: Mode;
  customer: CustomerVisibility;
  pick?: ReturnType<typeof createPicker>;
  /** A line written elsewhere (the AI writer). Replaces the mode's canned line. */
  line?: string | null;
}

const defaultPick = createPicker();

function join(...parts: (string | undefined)[]): string | undefined {
  const text = parts.filter(Boolean).join("\n");
  return text || undefined;
}

export function headline(sale: Sale, tier: Tier): string {
  const test = sale.livemode ? "" : "[TEST] ";
  return `${test}${GONG[tier]} ${formatAmount(sale.amountMinor, sale.currency)} ${SaleKindLabel[sale.kind]}`;
}

export function renderSale(sale: Sale, tier: Tier, opts: RenderOptions): Message {
  const pick = opts.pick ?? defaultPick;
  const tagline = opts.line ?? (opts.mode === "calm" ? undefined : pick(LINES[opts.mode][tier], `sale:${opts.mode}:${tier}`));
  const description = sale.description;
  return {
    title: headline(sale, tier),
    body: join(tagline, customerLabel(sale, opts.customer), description),
    tier,
    tone: "sale",
    // No customer data, ever, and test-mode sales are never public.
    publicText: sale.livemode
      ? `${GONG[tier]} ${formatAmount(sale.amountMinor, sale.currency)} ${SaleKindLabel[sale.kind]}`
      : undefined,
  };
}

export function renderMilestone(milestone: Milestone, opts: Pick<RenderOptions, "mode" | "pick">): Message {
  const pick = opts.pick ?? defaultPick;
  return {
    title: `🔔🔔 MILESTONE! ${milestone.text}`,
    body: pick(MILESTONE_LINES[opts.mode], `milestone:${opts.mode}`),
    tier: "big",
    tone: "milestone",
    publicText: `🔔 ${milestone.text}`,
  };
}

export function renderSad(sad: SadEvent, opts: Pick<RenderOptions, "mode" | "pick">): Message {
  const pick = opts.pick ?? defaultPick;
  const amount = formatAmount(sad.amountMinor, sad.currency);
  const test = sad.livemode ? "" : "[TEST] ";
  return {
    title: `${test}🔔💧 ${sad.type === "refund" ? `Refund: ${amount}` : `Subscription canceled: ${amount} MRR lost`}`,
    body: pick(SAD_LINES[opts.mode], `sad:${opts.mode}`),
    tier: "normal",
    tone: "sad",
    // Sad news stays private.
  };
}

const DISCORD_COLOR: Record<Tier, number> = {
  normal: 0xf5b301, // gold
  big: 0xff7a00, // orange
  huge: 0xe5226a, // magenta
};
const DISCORD_MILESTONE = 0x7c4dff;
const DISCORD_SAD = 0x6b7280;

export function discordPayload(message: Message) {
  const color = message.tone === "sad" ? DISCORD_SAD : message.tone === "milestone" ? DISCORD_MILESTONE : DISCORD_COLOR[message.tier];
  return {
    username: "MRR Gong",
    // Customer names/emails are attacker-controlled: never let them ping anyone.
    allowed_mentions: { parse: [] as string[] },
    embeds: [{ title: message.title, description: message.body, color }],
  };
}

/** Slack mrkdwn treats &, < and > as control characters. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function slackPayload(message: Message) {
  const body = message.body ? escapeSlack(message.body) : "";
  return {
    text: message.title,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: body ? `*${message.title}*\n${body}` : `*${message.title}*` },
      },
    ],
  };
}

const NTFY_PRIORITY: Record<Message["tone"], Record<Tier, number>> = {
  sale: { normal: 3, big: 4, huge: 5 },
  milestone: { normal: 4, big: 4, huge: 5 },
  sad: { normal: 2, big: 2, huge: 2 },
};

/** ntfy "publish as JSON": one POST to the server root, no header encoding issues. */
export function ntfyPayload(topic: string, message: Message) {
  return {
    topic,
    title: message.title,
    message: message.body ?? message.title,
    priority: NTFY_PRIORITY[message.tone][message.tier],
    tags: [message.tone === "sad" ? "droplet" : message.tone === "milestone" ? "tada" : "bell"],
  };
}
