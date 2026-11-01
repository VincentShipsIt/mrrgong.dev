import { formatAmount } from "./sale.ts";
import { SAD_KINDS, type CustomerVisibility, type Milestone, type Sale, type Tier } from "./types.ts";

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

const KIND_LABEL: Record<Sale["kind"], string> = {
  one_time: "sale",
  new_subscription: "new subscriber",
  renewal: "renewal",
  refund: "refunded",
  cancellation: "subscription canceled",
};

const GONG: Record<Tier, string> = {
  normal: "🔔 GONG!",
  big: "🔔🔔 GONG GONG!",
  huge: "🔔🔔🔔 GONGGGG!!! 🎉",
};

export function headline(sale: Sale, tier: Tier): string {
  const test = sale.livemode ? "" : "[TEST] ";
  if (SAD_KINDS.has(sale.kind)) return `${test}😔 ${formatAmount(sale.amountMinor, sale.currency)} ${KIND_LABEL[sale.kind]}`;
  return `${test}${GONG[tier]} ${formatAmount(sale.amountMinor, sale.currency)} ${KIND_LABEL[sale.kind]}`;
}

const DISCORD_COLOR: Record<Tier, number> = {
  normal: 0xf5b301, // gold
  big: 0xff7a00, // orange
  huge: 0xe5226a, // magenta
};

const SAD_COLOR = 0x808080; // grey

/** Customer line and description, per the visibility setting. */
export function details(sale: Sale, visibility: CustomerVisibility): string {
  const lines: string[] = [];
  const who = customerLabel(sale, visibility);
  if (who) lines.push(who);
  if (sale.description) lines.push(sale.description);
  return lines.join("\n");
}

export function discordPayload(sale: Sale, tier: Tier, visibility: CustomerVisibility) {
  return {
    username: "MRR Gong",
    // Customer names/emails are attacker-controlled: never let them ping anyone.
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: headline(sale, tier),
        description: details(sale, visibility) || undefined,
        color: SAD_KINDS.has(sale.kind) ? SAD_COLOR : DISCORD_COLOR[tier],
        timestamp: new Date(sale.created * 1000).toISOString(),
      },
    ],
  };
}

/** Slack mrkdwn treats &, < and > as control characters. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function slackPayload(sale: Sale, tier: Tier, visibility: CustomerVisibility) {
  const body = escapeSlack(details(sale, visibility));
  const title = headline(sale, tier);
  return {
    text: title,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: body ? `*${title}*\n${body}` : `*${title}*` },
      },
    ],
  };
}

const MILESTONE_COLOR = 0xe5226a; // the "huge" magenta: this is the big one

export function discordMilestonePayload(milestone: Milestone) {
  return {
    username: "MRR Gong",
    allowed_mentions: { parse: [] as string[] },
    embeds: [{ title: `🔔🔔🔔 ${milestone.title}`, color: MILESTONE_COLOR, timestamp: new Date().toISOString() }],
  };
}

export function slackMilestonePayload(milestone: Milestone) {
  const title = `🔔🔔🔔 ${milestone.title}`;
  return { text: title, blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${escapeSlack(title)}*` } }] };
}
