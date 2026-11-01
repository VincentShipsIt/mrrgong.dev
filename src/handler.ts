import { memoryDedupe } from "./dedupe.ts";
import { discordMilestonePayload, discordPayload, slackMilestonePayload, slackPayload } from "./format.ts";
import { parseSimulatedMilestone, type MilestoneTracker } from "./milestones.ts";
import { eventToSad, eventToSale, tierFor } from "./sale.ts";
import { verifyStripeSignature } from "./stripe.ts";
import { SAD_KINDS, type CustomerVisibility, type DedupeStore, type GongConfig, type Milestone, type Sink } from "./types.ts";

async function postJson(fetchImpl: typeof fetch, url: string, body: unknown): Promise<void> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
}

export function discordSink(url: string, visibility: CustomerVisibility, fetchImpl: typeof fetch): Sink {
  return Object.assign((sale: Parameters<Sink>[0], tier: Parameters<Sink>[1]) => postJson(fetchImpl, url, discordPayload(sale, tier, visibility)), {
    milestone: (m: Milestone) => postJson(fetchImpl, url, discordMilestonePayload(m)),
  });
}

export function slackSink(url: string, visibility: CustomerVisibility, fetchImpl: typeof fetch): Sink {
  return Object.assign((sale: Parameters<Sink>[0], tier: Parameters<Sink>[1]) => postJson(fetchImpl, url, slackPayload(sale, tier, visibility)), {
    milestone: (m: Milestone) => postJson(fetchImpl, url, slackMilestonePayload(m)),
  });
}

/** The configured chat sinks plus any extras (the browser gong, ...). */
export function buildSinks(config: GongConfig, fetchImpl: typeof fetch, extraSinks: Sink[] = []): Sink[] {
  const sinks: Sink[] = [...extraSinks];
  if (config.discordWebhookUrl) sinks.push(discordSink(config.discordWebhookUrl, config.customer, fetchImpl));
  if (config.slackWebhookUrl) sinks.push(slackSink(config.slackWebhookUrl, config.customer, fetchImpl));
  return sinks;
}

/** Tells every milestone-capable sink. Milestones carry no customer data, so public sinks get them too. */
export async function announceMilestone(sinks: Sink[], milestone: Milestone, log: (message: string) => void = () => {}): Promise<void> {
  const results = await Promise.allSettled(sinks.map((sink) => sink.milestone?.(milestone)));
  for (const r of results) if (r.status === "rejected") log(`milestone sink failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
}

export { memoryDedupe };

export interface HandlerOptions {
  config: GongConfig;
  fetch?: typeof fetch;
  dedupe?: DedupeStore;
  extraSinks?: Sink[];
  /** Replaces the sinks built from `config` and `extraSinks`; lets the server share one set with the MRR watcher. */
  sinks?: Sink[];
  /** Counts live sales and announces lifetime milestones. */
  milestones?: MilestoneTracker;
  log?: (message: string) => void;
  /** Called after a sale was announced to at least one sink. */
  onCelebrated?: () => void;
}

const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain" } });

/** Web-standard `Request -> Response`, so it runs on Node, Workers, Deno and Bun. */
export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  const { config, extraSinks = [], milestones, log = () => {} } = options;
  const fetchImpl = options.fetch ?? fetch;
  const dedupe = options.dedupe ?? memoryDedupe();

  const sinks = options.sinks ?? buildSinks(config, fetchImpl, extraSinks);

  return async (request) => {
    if (request.method !== "POST") return text(405, "POST only");

    // Signature must be checked against the exact bytes Stripe sent.
    const raw = await request.text();
    const valid = await verifyStripeSignature(
      raw,
      request.headers.get("stripe-signature"),
      config.stripeWebhookSecret,
      config.toleranceSeconds,
    );
    if (!valid) return text(400, "invalid signature");

    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      return text(400, "invalid json");
    }

    const preview = parseSimulatedMilestone(event);
    if (preview) {
      await announceMilestone(sinks, preview, log);
      return text(200, "gong");
    }

    const sale = eventToSale(event) ?? (config.sad ? eventToSad(event) : null);
    if (!sale) return text(200, "ignored");
    if (sale.kind === "renewal" && !config.celebrateRenewals) return text(200, "ignored");
    if (await dedupe.has(sale.dedupeKey)) return text(200, "duplicate");

    // Bad news stays in private channels.
    const targets = SAD_KINDS.has(sale.kind) ? sinks.filter((sink) => !sink.public) : sinks;
    if (targets.length === 0) return text(200, "no sinks configured");

    // Refunds and churn are never "big": a muted message, whatever the amount.
    const tier = SAD_KINDS.has(sale.kind) ? "normal" : tierFor(sale.amountMinor, sale.currency, config);
    const results = await Promise.allSettled(targets.map((sink) => sink(sale, tier)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const f of failures) log(`sink failed: ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`);

    // Only ask Stripe to retry if nobody heard the gong; otherwise a retry would double-post.
    if (failures.length === results.length) return text(500, "all sinks failed");
    await dedupe.add(sale.dedupeKey);
    options.onCelebrated?.();

    // Test-mode and sad events never count towards (or persist) lifetime milestones.
    if (milestones && sale.livemode && !SAD_KINDS.has(sale.kind)) {
      const milestone = await milestones.recordSale();
      if (milestone) await announceMilestone(sinks, milestone, log);
    }
    return text(200, "gong");
  };
}
