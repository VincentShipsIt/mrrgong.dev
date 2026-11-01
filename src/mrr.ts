import { formatAmount } from "./sale.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

/** Average days per month. */
const MONTH_WEEKS = 52 / 12;

function monthlyFactor(interval: unknown, count: number): number | null {
  const n = count > 0 ? count : 1;
  switch (interval) {
    case "day": return 30 / n;
    case "week": return MONTH_WEEKS / n;
    case "month": return 1 / n;
    case "year": return 1 / (12 * n);
    default: return null;
  }
}

/**
 * MRR in each currency's minor unit from Stripe subscription objects.
 * Only `active` subscriptions count. Items without a flat `unit_amount` (metered or tiered)
 * are skipped rather than guessed: an honest undercount beats an invented number.
 */
export function computeMrr(subscriptions: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of subscriptions) {
    if (!isObj(s) || s.status !== "active" || !isObj(s.items) || !Array.isArray(s.items.data)) continue;

    const byCurrency: Record<string, number> = {};
    for (const it of s.items.data) {
      if (!isObj(it) || !isObj(it.price)) continue;
      const price = it.price;
      const rec = isObj(price.recurring) ? price.recurring : null;
      if (!rec || typeof price.unit_amount !== "number" || typeof price.currency !== "string") continue;
      const factor = monthlyFactor(rec.interval, typeof rec.interval_count === "number" ? rec.interval_count : 1);
      if (factor === null) continue;
      const qty = typeof it.quantity === "number" ? it.quantity : 1;
      const cur = price.currency.toUpperCase();
      byCurrency[cur] = (byCurrency[cur] ?? 0) + price.unit_amount * qty * factor;
    }

    const discounts = Array.isArray(s.discounts) ? s.discounts : [];
    for (const [cur, amount] of Object.entries(byCurrency)) {
      let value = amount;
      for (const d of discounts) {
        const coupon = isObj(d) && isObj(d.coupon) ? d.coupon : null;
        if (!coupon) continue;
        if (typeof coupon.percent_off === "number") value *= 1 - coupon.percent_off / 100;
        else if (typeof coupon.amount_off === "number") value -= coupon.amount_off;
      }
      out[cur] = (out[cur] ?? 0) + Math.max(0, Math.round(value));
    }
  }
  return out;
}

export async function fetchActiveSubscriptions(apiKey: string, fetchImpl: typeof fetch = fetch, maxPages = 50): Promise<unknown[]> {
  const all: unknown[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL("https://api.stripe.com/v1/subscriptions");
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", "100");
    url.searchParams.append("expand[]", "data.discounts");
    if (after) url.searchParams.set("starting_after", after);
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Stripe API responded ${res.status}`);
    const body: unknown = await res.json();
    if (!isObj(body) || !Array.isArray(body.data)) throw new Error("unexpected Stripe response");
    all.push(...body.data);
    const last = body.data[body.data.length - 1];
    if (body.has_more !== true || !isObj(last) || typeof last.id !== "string") break;
    after = last.id;
  }
  return all;
}

export interface Snapshot {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  mrrMinor: number;
  currency: string;
}

const MAX_DAYS = 400;

export function recordSnapshot(history: Snapshot[], snapshot: Snapshot): Snapshot[] {
  const next = history.filter((s) => s.date !== snapshot.date);
  next.push(snapshot);
  next.sort((a, b) => a.date.localeCompare(b.date));
  return next.slice(-MAX_DAYS);
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive days where MRR ended higher than the day before.
 * Today only counts once it has beaten yesterday, but being flat so far today does not
 * break the streak: the day isn't over. A missing day or a dip breaks it.
 */
export function streakDays(history: Snapshot[], today: string): number {
  const byDate = new Map(history.map((s) => [s.date, s.mrrMinor]));
  const yesterday = dayBefore(today);
  let streak = 0;

  const todayValue = byDate.get(today);
  const yesterdayValue = byDate.get(yesterday);
  if (todayValue !== undefined && yesterdayValue !== undefined && todayValue > yesterdayValue) streak++;

  let day = yesterday;
  for (;;) {
    const v = byDate.get(day);
    const prev = byDate.get(dayBefore(day));
    if (v === undefined || prev === undefined || v <= prev) break;
    streak++;
    day = dayBefore(day);
  }
  return streak;
}

export interface MrrSummary {
  mrrMinor: number;
  currency: string;
  formatted: string;
  todayDeltaMinor: number;
  streakDays: number;
  goalMinor?: number;
  goalPercentLeft?: number;
}

export function mrrSummary(history: Snapshot[], today: string, goalMinor?: number): MrrSummary | null {
  const latest = history[history.length - 1];
  if (!latest) return null;
  const yesterday = history.find((s) => s.date === dayBefore(today));
  const summary: MrrSummary = {
    mrrMinor: latest.mrrMinor,
    currency: latest.currency,
    formatted: formatAmount(latest.mrrMinor, latest.currency),
    todayDeltaMinor: yesterday ? latest.mrrMinor - yesterday.mrrMinor : 0,
    streakDays: streakDays(history, today),
  };
  if (goalMinor && goalMinor > 0) {
    summary.goalMinor = goalMinor;
    summary.goalPercentLeft = Math.max(0, Math.min(100, Math.round((1 - latest.mrrMinor / goalMinor) * 100)));
  }
  return summary;
}
