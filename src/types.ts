export type SaleKind = "one_time" | "new_subscription" | "renewal" | "refund" | "cancellation";
/** Kinds that are bad news: refunds and churn. Opt-in, muted, never public. */
export const SAD_KINDS: ReadonlySet<SaleKind> = new Set<SaleKind>(["refund", "cancellation"]);
export type Tier = "normal" | "big" | "huge";

export type MilestoneKind = "first_sale" | "sales" | "mrr";

/** Public-safe by construction: a title and nothing about any customer. */
export interface Milestone {
  kind: MilestoneKind;
  title: string;
}

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
  /** Also post a muted message for refunds and canceled subscriptions. Private channels only. */
  sad: boolean;
  customer: CustomerVisibility;
  /** Restricted, read-only Stripe key (rk_...). Enables the MRR watcher. */
  stripeApiKey?: string;
  /** Major units. Shows "% left" towards this MRR goal. */
  mrrGoal?: number;
  mrrPollMinutes: number;
  /** Major units. Crossing one for the first time announces a milestone. */
  mrrMilestones: number[];
  /** Lifetime sale counts that announce a milestone (1 is the "first sale"). */
  saleMilestones: number[];
  /** Sales that happened before this server started counting. */
  salesSoFar: number;
  /** Stripe's recommended replay window, in seconds. */
  toleranceSeconds: number;
}

/** Something that gets told about a sale: Discord, Slack, the browser gong... */
export type Sink = ((sale: Sale, tier: Tier) => Promise<void>) & {
  /** Set on sinks that publish to the outside world (X...). Sad events never reach them. */
  public?: boolean;
  /** Sinks without this simply skip milestones. */
  milestone?: (milestone: Milestone) => Promise<void>;
};

/** Remembers which sales were already celebrated. */
export interface DedupeStore {
  has(key: string): Promise<boolean>;
  add(key: string): Promise<void>;
}
