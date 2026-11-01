import { DEFAULT_MRR_MILESTONES, DEFAULT_SALE_MILESTONES, parseThresholds } from "./milestones.ts";
import type { CustomerVisibility, GongConfig, XCredentials } from "./types.ts";

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

function ntfyServer(env: Env): string {
  const raw = env.NTFY_SERVER?.trim();
  if (!raw) return "https://ntfy.sh";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NTFY_SERVER is not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("NTFY_SERVER must be an https URL");
  return raw.replace(/\/+$/, "");
}

const X_VARS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"] as const;

function xCredentials(env: Env): XCredentials | undefined {
  const [apiKey, apiSecret, accessToken, accessSecret] = X_VARS.map((name) => env[name]?.trim() || undefined);
  if (!apiKey && !apiSecret && !accessToken && !accessSecret) return undefined;
  const missing = X_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new Error(`X posting needs all four credentials; missing ${missing.join(", ")}`);
  return { apiKey: apiKey!, apiSecret: apiSecret!, accessToken: accessToken!, accessSecret: accessSecret! };
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

  const ntfyTopic = env.NTFY_TOPIC?.trim() || undefined;
  if (ntfyTopic && !/^[A-Za-z0-9_-]{1,64}$/.test(ntfyTopic)) {
    throw new Error("NTFY_TOPIC may only contain letters, digits, - and _ (max 64)");
  }

  return {
    stripeWebhookSecret: secret,
    ntfyTopic,
    ntfyServer: ntfyServer(env),
    x: xCredentials(env),
    xPostAllOver: env.X_POST_ALL_OVER?.trim() ? num(env, "X_POST_ALL_OVER", 0) : undefined,
    stripeApiKey,
    mrrGoal,
    mrrPollMinutes,
    mrrMilestones: parseThresholds(env.GONG_MRR_MILESTONES, "GONG_MRR_MILESTONES", DEFAULT_MRR_MILESTONES),
    saleMilestones: parseThresholds(env.GONG_SALE_MILESTONES, "GONG_SALE_MILESTONES", DEFAULT_SALE_MILESTONES),
    salesSoFar: Math.floor(num(env, "GONG_SALES_SO_FAR", 0)),
    discordWebhookUrl: webhookUrl(env, "DISCORD_WEBHOOK_URL", (h) => DISCORD_HOSTS.has(h)),
    slackWebhookUrl: webhookUrl(env, "SLACK_WEBHOOK_URL", (h) => h === "hooks.slack.com"),
    bigAt,
    hugeAt,
    celebrateRenewals: env.GONG_RENEWALS?.trim().toLowerCase() !== "false",
    sad: env.GONG_SAD?.trim().toLowerCase() === "true",
    customer,
    toleranceSeconds: 300,
  };
}
