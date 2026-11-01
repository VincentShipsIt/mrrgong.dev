export type SaleKind = "one_time" | "new_subscription" | "renewal";
export type Tier = "normal" | "big" | "huge";

export interface Sale {
  /** Stable key used to avoid celebrating the same payment twice. */
  dedupeKey: string;
  /** Amount in the currency's minor unit (cents for USD). */
  amountMinor: number;
  currency: string;
  kind: SaleKind;
  livemode: boolean;
  customerName?: string;
  customerEmail?: string;
  description?: string;
  /** Unix seconds. */
  created: number;
}

export type CustomerVisibility = "full" | "masked" | "none";

export interface GongConfig {
  stripeWebhookSecret: string;
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
  /** Major units. A sale at or above this gets the "big" gong. */
  bigAt: number;
  /** Major units. A sale at or above this gets the full ceremony. */
  hugeAt: number;
  celebrateRenewals: boolean;
  customer: CustomerVisibility;
  /** Restricted, read-only Stripe key (rk_...). Enables the MRR watcher. */
  stripeApiKey?: string;
  /** Major units. Shows "% left" towards this MRR goal. */
  mrrGoal?: number;
  mrrPollMinutes: number;
  /** Stripe's recommended replay window, in seconds. */
  toleranceSeconds: number;
}

/** Something that gets told about a sale: Discord, Slack, the browser gong... */
export type Sink = (sale: Sale, tier: Tier) => Promise<void>;

/** Remembers which sales were already celebrated. */
export interface DedupeStore {
  has(key: string): Promise<boolean>;
  add(key: string): Promise<void>;
}
