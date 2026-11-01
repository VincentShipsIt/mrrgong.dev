export type SaleKind = "one_time" | "new_subscription" | "renewal";
export type Tier = "normal" | "big" | "huge";
export type Mode = "calm" | "indie" | "broker";

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

/** A refund or a canceled subscription. Only announced when GONG_SAD=true, and never publicly. */
export interface SadEvent {
  dedupeKey: string;
  type: "refund" | "cancel";
  amountMinor: number;
  currency: string;
  livemode: boolean;
  created: number;
}

export interface Milestone {
  /** Stable id, e.g. `mrr:100000:USD`. Used to fire each milestone once. */
  id: string;
  kind: "first_sale" | "sales" | "mrr" | "streak";
  /** Plain, customer-free sentence that is safe to post publicly. */
  text: string;
}

export type CustomerVisibility = "full" | "masked" | "none";

export interface GongConfig {
  stripeWebhookSecret: string;
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
  ntfyTopic?: string;
  ntfyServer: string;
  x?: { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string };
  /** Major units. Post sales at or above this to X as well as milestones. */
  xPostAllOver?: number;
  /** Restricted, read-only Stripe key (rk_...). Enables the MRR watcher. */
  stripeApiKey?: string;
  /** Major units. Shows "% left" towards this MRR goal. */
  mrrGoal?: number;
  mrrPollMinutes: number;
  /** Anthropic key for the optional gong writer. Off when unset. */
  anthropicApiKey?: string;
  aiModel: string;
  mode: Mode;
  /** Announce refunds and canceled subscriptions. */
  sad: boolean;
  milestones: boolean;
  /** Major units. A sale at or above this gets the "big" gong. */
  bigAt: number;
  /** Major units. A sale at or above this gets the full ceremony. */
  hugeAt: number;
  celebrateRenewals: boolean;
  customer: CustomerVisibility;
  /** Stripe's recommended replay window, in seconds. */
  toleranceSeconds: number;
}

/** A rendered notification. Channels pick what they need; none re-derive customer data. */
export interface Message {
  title: string;
  /** Plain text; may contain the customer label. Channels escape it for their own syntax. */
  body?: string;
  tier: Tier;
  /** "sad" and "milestone" change colour and tone in channels that have one. */
  tone: "sale" | "milestone" | "sad";
  /** Customer-free text safe for public channels. Absent when nothing should ever be posted publicly. */
  publicText?: string;
}

export type GongEvent =
  | { type: "sale"; sale: Sale; tier: Tier; message: Message }
  | { type: "milestone"; milestone: Milestone; message: Message }
  | { type: "sad"; sad: SadEvent; message: Message };

/** Something that gets told about an event: Discord, Slack, ntfy, X, the browser gong... */
export type Sink = (event: GongEvent) => Promise<void>;

/** Small async key/value store. Backed by memory, a file (Node) or Cloudflare KV (Workers). */
export interface StateStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds?: number): Promise<void>;
}

/** Remembers which sales were already celebrated. */
export interface DedupeStore {
  has(key: string): Promise<boolean>;
  add(key: string): Promise<void>;
}
