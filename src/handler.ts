import { discordPayload, slackPayload } from "./format.ts";
import { eventToSale, tierFor } from "./sale.ts";
import { verifyStripeSignature } from "./stripe.ts";
import type { CustomerVisibility, DedupeStore, GongConfig, Sink } from "./types.ts";

export function memoryDedupe(max = 5000): DedupeStore {
  const seen = new Set<string>();
  return {
    has: (key) => seen.has(key),
    add(key) {
      seen.add(key);
      if (seen.size > max) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
    },
  };
}

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
  return (sale, tier) => postJson(fetchImpl, url, discordPayload(sale, tier, visibility));
}

export function slackSink(url: string, visibility: CustomerVisibility, fetchImpl: typeof fetch): Sink {
  return (sale, tier) => postJson(fetchImpl, url, slackPayload(sale, tier, visibility));
}

export interface HandlerOptions {
  config: GongConfig;
  fetch?: typeof fetch;
  dedupe?: DedupeStore;
  extraSinks?: Sink[];
  log?: (message: string) => void;
}

const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain" } });

/** Web-standard `Request -> Response`, so it runs on Node, Workers, Deno and Bun. */
export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  const { config, extraSinks = [], log = () => {} } = options;
  const fetchImpl = options.fetch ?? fetch;
  const dedupe = options.dedupe ?? memoryDedupe();

  const sinks: Sink[] = [...extraSinks];
  if (config.discordWebhookUrl) sinks.push(discordSink(config.discordWebhookUrl, config.customer, fetchImpl));
  if (config.slackWebhookUrl) sinks.push(slackSink(config.slackWebhookUrl, config.customer, fetchImpl));

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

    const sale = eventToSale(event);
    if (!sale) return text(200, "ignored");
    if (sale.kind === "renewal" && !config.celebrateRenewals) return text(200, "ignored");
    if (dedupe.has(sale.dedupeKey)) return text(200, "duplicate");
    if (sinks.length === 0) return text(200, "no sinks configured");

    const tier = tierFor(sale.amountMinor, sale.currency, config);
    const results = await Promise.allSettled(sinks.map((sink) => sink(sale, tier)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const f of failures) log(`sink failed: ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`);

    // Only ask Stripe to retry if nobody heard the gong; otherwise a retry would double-post.
    if (failures.length === results.length) return text(500, "all sinks failed");
    dedupe.add(sale.dedupeKey);
    return text(200, "gong");
  };
}
