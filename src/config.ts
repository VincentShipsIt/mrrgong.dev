import type { CustomerVisibility, GongConfig } from "./types.ts";

export type Env = Record<string, string | undefined>;

const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"]);

function webhookUrl(env: Env, name: string, hosts: (h: string) => boolean): string | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.protocol !== "https:" || !hosts(url.hostname)) {
    throw new Error(`${name} must be an https URL on the provider's own webhook host`);
  }
  return raw;
}

function num(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

export function loadConfig(env: Env): GongConfig {
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is required (Stripe dashboard → Webhooks → signing secret)");

  const customer = (env.GONG_CUSTOMER?.trim() || "masked") as CustomerVisibility;
  if (!["full", "masked", "none"].includes(customer)) {
    throw new Error(`GONG_CUSTOMER must be full, masked or none, got "${customer}"`);
  }

  const bigAt = num(env, "GONG_BIG_AT", 100);
  const hugeAt = num(env, "GONG_HUGE_AT", 1000);
  if (hugeAt < bigAt) throw new Error("GONG_HUGE_AT must be >= GONG_BIG_AT");

  const stripeApiKey = env.STRIPE_API_KEY?.trim() || undefined;
  if (stripeApiKey && !/^(rk|sk)_(live|test)_/.test(stripeApiKey)) {
    throw new Error("STRIPE_API_KEY must be a Stripe key starting with rk_ (restricted, recommended) or sk_");
  }
  const mrrGoal = env.MRR_GOAL?.trim() ? num(env, "MRR_GOAL", 0) : undefined;
  const mrrPollMinutes = num(env, "MRR_POLL_MINUTES", 15);
  if (mrrPollMinutes < 1) throw new Error("MRR_POLL_MINUTES must be at least 1");

  return {
    stripeWebhookSecret: secret,
    stripeApiKey,
    mrrGoal,
    mrrPollMinutes,
    discordWebhookUrl: webhookUrl(env, "DISCORD_WEBHOOK_URL", (h) => DISCORD_HOSTS.has(h)),
    slackWebhookUrl: webhookUrl(env, "SLACK_WEBHOOK_URL", (h) => h === "hooks.slack.com"),
    bigAt,
    hugeAt,
    celebrateRenewals: env.GONG_RENEWALS?.trim().toLowerCase() !== "false",
    customer,
    toleranceSeconds: 300,
  };
}
