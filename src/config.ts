import { MRR_THRESHOLDS, SALE_COUNTS } from "./milestones.ts";
import type { CustomerVisibility, GongConfig, Mode } from "./types.ts";

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

function flag(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false, got "${raw}"`);
}

function num(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

function salesSoFar(env: Env): number | undefined {
  const raw = env.GONG_SALES_SO_FAR?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`GONG_SALES_SO_FAR must be a whole number of 0 or more, got "${raw}"`);
  return n;
}

/** Comma list of positive numbers; `none` turns the ladder off. Sorted and de-duplicated. */
function ladder(env: Env, name: string, fallback: number[], integers: boolean): number[] {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (raw.toLowerCase() === "none") return [];
  const values = raw.split(",").map((part) => Number(part.trim()));
  if (values.some((n) => !Number.isFinite(n) || n <= 0 || (integers && !Number.isInteger(n)))) {
    throw new Error(`${name} must be a comma list of positive ${integers ? "whole " : ""}numbers (or "none"), got "${raw}"`);
  }
  return [...new Set(values)].sort((a, b) => a - b);
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

  const mode = (env.GONG_MODE?.trim().toLowerCase() || "calm") as Mode;
  if (!["calm", "indie", "broker"].includes(mode)) throw new Error(`GONG_MODE must be calm, indie or broker, got "${mode}"`);

  const ntfyServer = env.NTFY_SERVER?.trim() || "https://ntfy.sh";
  try {
    if (new URL(ntfyServer).protocol !== "https:") throw new Error();
  } catch {
    throw new Error("NTFY_SERVER must be an https URL");
  }
  const ntfyTopic = env.NTFY_TOPIC?.trim() || undefined;
  if (ntfyTopic && !/^[A-Za-z0-9_-]{1,64}$/.test(ntfyTopic)) throw new Error("NTFY_TOPIC may only contain letters, digits, _ and -");

  const xKeys = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"] as const;
  const xSet = xKeys.filter((k) => env[k]?.trim());
  if (xSet.length > 0 && xSet.length < xKeys.length) {
    throw new Error(`X needs all of ${xKeys.join(", ")}; missing ${xKeys.filter((k) => !xSet.includes(k)).join(", ")}`);
  }
  const x = xSet.length === xKeys.length
    ? { apiKey: env.X_API_KEY!.trim(), apiSecret: env.X_API_SECRET!.trim(), accessToken: env.X_ACCESS_TOKEN!.trim(), accessSecret: env.X_ACCESS_SECRET!.trim() }
    : undefined;

  return {
    stripeWebhookSecret: secret,
    ntfyTopic,
    ntfyServer,
    x,
    xPostAllOver: env.X_POST_ALL_OVER?.trim() ? num(env, "X_POST_ALL_OVER", 0) : undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    aiModel: env.GONG_AI_MODEL?.trim() || "claude-haiku-5-5",
    mode,
    sad: flag(env, "GONG_SAD", false),
    milestones: flag(env, "GONG_MILESTONES", true),
    saleMilestones: ladder(env, "GONG_SALE_MILESTONES", SALE_COUNTS, true),
    mrrMilestones: ladder(env, "GONG_MRR_MILESTONES", MRR_THRESHOLDS, false),
    salesSoFar: salesSoFar(env),
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
