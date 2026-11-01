import type { MrrSummary } from "./mrr.ts";
import { formatAmount, minorUnits } from "./sale.ts";
import type { Milestone, Sale, StateStore } from "./types.ts";

/** Lifetime sale counts that deserve a message (the first sale is always celebrated). */
export const SALE_COUNTS = [10, 100, 1000, 10_000];
/** MRR thresholds in major units (dollars, not cents). */
export const MRR_THRESHOLDS = [100, 500, 1000, 5000, 10_000, 25_000, 50_000, 100_000];
export const STREAK_DAYS = [7, 30, 100, 365];

function money(minor: number, currency: string): string {
  return formatAmount(minor, currency).replace(/\.00$/, "");
}

/**
 * Counts real (live-mode, non-renewal) sales and returns any milestone this sale reached.
 * State is a plain counter, so a restart cannot repeat a milestone.
 */
export async function checkSaleMilestones(state: StateStore, sale: Sale): Promise<Milestone[]> {
  if (!sale.livemode || sale.kind === "renewal") return [];
  const stored = Number(await state.get("stats:sales"));
  const count = (Number.isFinite(stored) && stored >= 0 ? stored : 0) + 1;
  await state.put("stats:sales", String(count));

  if (count === 1) return [{ id: "sales:first", kind: "first_sale", text: "First sale ever. Someone paid for your thing." }];
  if (SALE_COUNTS.includes(count)) return [{ id: `sales:${count}`, kind: "sales", text: `${count} sales and counting.` }];
  return [];
}

/**
 * Compares a fresh MRR reading with what has already been announced.
 * The first reading only records where you already are: installing mrrgong at $3k MRR must
 * not claim you "just crossed" $1k. After that, crossing several thresholds at once announces
 * only the highest, and nothing fires twice.
 */
export async function checkMrrMilestones(state: StateStore, summary: MrrSummary): Promise<Milestone[]> {
  const { currency } = summary;
  const fired = async (id: string) => (await state.get(`ms:${id}`)) !== null;
  const mark = (id: string) => state.put(`ms:${id}`, "1");
  const out: Milestone[] = [];

  const crossed = MRR_THRESHOLDS.filter((t) => summary.mrrMinor >= minorUnits(t, currency));
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

  for (const days of STREAK_DAYS) {
    if (summary.streakDays >= days && !(await fired(`streak:${days}`))) {
      await mark(`streak:${days}`);
      out.push({ id: `streak:${days}`, kind: "streak", text: `MRR is up ${days} days in a row.` });
    }
  }
  return out;
}
