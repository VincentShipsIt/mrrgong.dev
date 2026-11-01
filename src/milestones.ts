import type { MrrSummary } from "./mrr.ts";
import { formatAmount, minorUnits } from "./sale.ts";
import type { Milestone, Sale, StateStore } from "./types.ts";

/** Lifetime sale counts that deserve a message (the first sale is always celebrated). */
export const SALE_COUNTS = [10, 100, 1000, 10_000];
/** MRR thresholds in major units (dollars, not cents). */
export const MRR_THRESHOLDS = [100, 500, 1000, 5000, 10_000, 25_000, 50_000, 100_000];
export const STREAK_DAYS = [7, 30, 100, 365];

/** What counts as a milestone. Defaults are the constants above; config can override each ladder. */
export interface MilestoneRules {
  saleCounts: number[];
  /** Major units. */
  mrrThresholds: number[];
  streakDays: number[];
  /** Lifetime sales before mrrgong was installed, so an existing shop skips the "first sale". */
  salesSoFar?: number;
}

export const DEFAULT_RULES: MilestoneRules = { saleCounts: SALE_COUNTS, mrrThresholds: MRR_THRESHOLDS, streakDays: STREAK_DAYS };

function money(minor: number, currency: string): string {
  return formatAmount(minor, currency).replace(/\.00$/, "");
}

/**
 * Counts real (live-mode, non-renewal) sales and returns any milestone this sale reached.
 * State is a plain counter, so a restart cannot repeat a milestone.
 */
export async function checkSaleMilestones(state: StateStore, sale: Sale, rules: MilestoneRules = DEFAULT_RULES): Promise<Milestone[]> {
  if (!sale.livemode || sale.kind === "renewal") return [];
  const raw = await state.get("stats:sales");
  const stored = Number(raw);
  // The seed applies only until the first count is stored, so a stale setting never rewinds it.
  const base = raw === null ? (rules.salesSoFar ?? 0) : Number.isFinite(stored) && stored >= 0 ? stored : 0;
  const count = base + 1;
  await state.put("stats:sales", String(count));

  if (count === 1) return [{ id: "sales:first", kind: "first_sale", text: "First sale ever. Someone paid for your thing." }];
  if (rules.saleCounts.includes(count)) return [{ id: `sales:${count}`, kind: "sales", text: `${count} sales and counting.` }];
  return [];
}

/**
 * Compares a fresh MRR reading with what has already been announced.
 * The first reading only records where you already are: installing mrrgong at $3k MRR must
 * not claim you "just crossed" $1k. After that, crossing several thresholds at once announces
 * only the highest, and nothing fires twice.
 */
export async function checkMrrMilestones(state: StateStore, summary: MrrSummary, rules: MilestoneRules = DEFAULT_RULES): Promise<Milestone[]> {
  const { currency } = summary;
  const fired = async (id: string) => (await state.get(`ms:${id}`)) !== null;
  const mark = (id: string) => state.put(`ms:${id}`, "1");
  const out: Milestone[] = [];

  const crossed = rules.mrrThresholds.filter((t) => summary.mrrMinor >= minorUnits(t, currency));
  const initKey = `init:mrr:${currency}`;
  if ((await state.get(`ms:${initKey}`)) === null) {
    await mark(initKey);
    for (const t of crossed) await mark(`mrr:${t}:${currency}`);
  } else {
    const fresh: number[] = [];
    for (const t of crossed) if (!(await fired(`mrr:${t}:${currency}`))) fresh.push(t);
    for (const t of fresh) await mark(`mrr:${t}:${currency}`);
    const top = fresh[fresh.length - 1];
    if (top !== undefined) {
      out.push({ id: `mrr:${top}:${currency}`, kind: "mrr", text: `MRR just crossed ${money(minorUnits(top, currency), currency)}.` });
    }
  }

  for (const days of rules.streakDays) {
    if (summary.streakDays >= days && !(await fired(`streak:${days}`))) {
      await mark(`streak:${days}`);
      out.push({ id: `streak:${days}`, kind: "streak", text: `MRR is up ${days} days in a row.` });
    }
  }
  return out;
}

/**
 * `npm run simulate -- --mrr 5000` / `--sales 100` send a signed preview event. It is announced to
 * every channel but never touches the counters. Values are validated because the text ends up in
 * public channels, even though only the webhook secret's owner can sign one.
 */
export function parseSimulatedMilestone(event: unknown): Milestone | null {
  const e = event as { type?: unknown; data?: { object?: Record<string, unknown> } } | null;
  if (e?.type !== "mrrgong.simulate.milestone") return null;
  const o = e.data?.object;
  if (!o || typeof o !== "object") return null;
  if (o.kind === "mrr") {
    const { amount, currency } = o;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) return null;
    const cur = currency.toUpperCase();
    return { id: `preview:mrr:${amount}:${cur}`, kind: "mrr", text: `MRR just crossed ${money(minorUnits(amount, cur), cur)}.` };
  }
  if (o.kind === "sales") {
    const { count } = o;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return null;
    return count === 1
      ? { id: "preview:sales:first", kind: "first_sale", text: "First sale ever. Someone paid for your thing." }
      : { id: `preview:sales:${count}`, kind: "sales", text: `${count} sales and counting.` };
  }
  return null;
}
