import { createPicker } from "./copy.ts";
import { discordPayload, ntfyPayload, renderMilestone, renderSad, renderSale, slackPayload } from "./format.ts";
import { checkMrrMilestones, checkSaleMilestones, parseSimulatedMilestone, STREAK_DAYS, type MilestoneRules } from "./milestones.ts";
import type { MrrSummary } from "./mrr.ts";
import { eventToSad } from "./sad.ts";
import { eventToSale, majorUnits, tierFor } from "./sale.ts";
import { memoryState, resilientDedupe, stateDedupe } from "./state.ts";
import { verifyStripeSignature } from "./stripe.ts";
import type { DedupeStore, GongConfig, GongEvent, Message, Sink, StateStore } from "./types.ts";
import type { LineWriter } from "./writer.ts";
import { xSink } from "./x.ts";

export { memoryDedupe } from "./state.ts";

async function postJson(fetchImpl: typeof fetch, url: string, body: unknown): Promise<void> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
}

const messageSink = (url: string, payload: (m: Message) => unknown, fetchImpl: typeof fetch): Sink =>
  (event) => postJson(fetchImpl, url, payload(event.message));

export const discordSink = (url: string, fetchImpl: typeof fetch): Sink => messageSink(url, discordPayload, fetchImpl);
export const slackSink = (url: string, fetchImpl: typeof fetch): Sink => messageSink(url, slackPayload, fetchImpl);
export const ntfySink = (server: string, topic: string, fetchImpl: typeof fetch): Sink =>
  messageSink(server, (m) => ntfyPayload(topic, m), fetchImpl);

export interface HandlerOptions {
  config: GongConfig;
  fetch?: typeof fetch;
  /** Defaults to a dedupe backed by `state`. */
  dedupe?: DedupeStore;
  /** Milestone counters and (by default) dedupe keys live here. Defaults to memory. */
  state?: StateStore;
  extraSinks?: Sink[];
  /** Optional AI line writer; its output replaces the canned tagline. */
  writer?: LineWriter;
  pick?: ReturnType<typeof createPicker>;
  log?: (message: string) => void;
  /** Called after a sale was announced to at least one sink. */
  onCelebrated?: () => void;
}

export interface Gong {
  /** Web-standard `Request -> Response`, so it runs on Node, Workers, Deno and Bun. */
  handle(request: Request): Promise<Response>;
  /** Feed a fresh MRR reading to the milestone engine (MRR and streak milestones). */
  onMrr(summary: MrrSummary): Promise<void>;
}

const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain" } });

export function createGong(options: HandlerOptions): Gong {
  const { config, extraSinks = [], log = () => {} } = options;
  const fetchImpl = options.fetch ?? fetch;
  const state = options.state ?? memoryState();
  const dedupe = options.dedupe ?? resilientDedupe(stateDedupe(state), log);
  const pick = options.pick ?? createPicker();

  const rules: MilestoneRules = {
    saleCounts: config.saleMilestones,
    mrrThresholds: config.mrrMilestones,
    streakDays: STREAK_DAYS,
    salesSoFar: config.salesSoFar,
  };

  const sinks: Sink[] = [...extraSinks];
  if (config.discordWebhookUrl) sinks.push(discordSink(config.discordWebhookUrl, fetchImpl));
  if (config.slackWebhookUrl) sinks.push(slackSink(config.slackWebhookUrl, fetchImpl));
  if (config.ntfyTopic) sinks.push(ntfySink(config.ntfyServer, config.ntfyTopic, fetchImpl));
  if (config.x) sinks.push(xSink({ creds: config.x, postAllOverMajor: config.xPostAllOver, fetch: fetchImpl }));

  /** Sends to every sink. Returns true if at least one heard it. */
  async function announce(event: GongEvent): Promise<boolean> {
    const results = await Promise.allSettled(sinks.map((sink) => sink(event)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const f of failures) log(`sink failed: ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`);
    return results.length > 0 && failures.length < results.length;
  }

  async function announceMilestones(milestones: { id: string; kind: "first_sale" | "sales" | "mrr" | "streak"; text: string }[]) {
    for (const milestone of milestones) {
      const message = renderMilestone(milestone, { mode: config.mode, pick });
      await announce({ type: "milestone", milestone, message });
    }
  }

  async function handleSale(sale: NonNullable<ReturnType<typeof eventToSale>>): Promise<Response> {
    if (sale.kind === "renewal" && !config.celebrateRenewals) return text(200, "ignored");
    if (await dedupe.has(sale.dedupeKey)) return text(200, "duplicate");
    if (sinks.length === 0) return text(200, "no sinks configured");

    const tier = tierFor(sale.amountMinor, sale.currency, config);
    const line = options.writer
      ? await options.writer({ tier, kind: sale.kind, amountMajor: majorUnits(sale.amountMinor, sale.currency), currency: sale.currency, mode: config.mode })
      : null;
    const message = renderSale(sale, tier, { mode: config.mode, customer: config.customer, pick, line });

    // Only ask Stripe to retry if nobody heard the gong; otherwise a retry would double-post.
    if (!(await announce({ type: "sale", sale, tier, message }))) return text(500, "all sinks failed");
    await dedupe.add(sale.dedupeKey);
    options.onCelebrated?.();

    if (config.milestones) {
      try {
        await announceMilestones(await checkSaleMilestones(state, sale, rules));
      } catch (err) {
        log(`milestone check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return text(200, "gong");
  }

  async function handleSad(sad: NonNullable<ReturnType<typeof eventToSad>>): Promise<Response> {
    if (await dedupe.has(sad.dedupeKey)) return text(200, "duplicate");
    if (sinks.length === 0) return text(200, "no sinks configured");
    const message = renderSad(sad, { mode: config.mode, pick });
    if (!(await announce({ type: "sad", sad, message }))) return text(500, "all sinks failed");
    await dedupe.add(sad.dedupeKey);
    return text(200, "sad gong");
  }

  return {
    async handle(request) {
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
        if (!config.milestones) return text(200, "milestones off");
        if (sinks.length === 0) return text(200, "no sinks configured");
        await announceMilestones([preview]);
        return text(200, "gong");
      }

      const sale = eventToSale(event);
      if (sale) return handleSale(sale);
      const sad = config.sad ? eventToSad(event) : null;
      if (sad) return handleSad(sad);
      return text(200, "ignored");
    },

    async onMrr(summary) {
      if (!config.milestones || sinks.length === 0) return;
      try {
        await announceMilestones(await checkMrrMilestones(state, summary, rules));
      } catch (err) {
        log(`mrr milestone check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

/** Back-compat shorthand used by the Worker and tests. */
export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  return createGong(options).handle;
}
