import { readFile, rename, writeFile } from "node:fs/promises";
import type { KvLike } from "./dedupe.ts";
import { formatAmount, minorUnits } from "./sale.ts";
import type { Milestone } from "./types.ts";

export type { Milestone, MilestoneKind } from "./types.ts";

/** Defaults in major units (dollars) for MRR, plain counts for sales. */
export const DEFAULT_MRR_MILESTONES: readonly number[] = [100, 500, 1000, 5000, 10000];
export const DEFAULT_SALE_MILESTONES: readonly number[] = [1, 10, 100, 1000];

export interface MilestoneState {
  /** Sales this server has announced (plus `initialSales`). */
  sales: number;
  salesSeeded: boolean;
  firedSales: number[];
  mrrSeeded: boolean;
  /** Thresholds in major units that already fired (or were already behind us at install). */
  firedMrr: number[];
}

export interface MilestoneStore {
  load(): Promise<MilestoneState>;
  save(state: MilestoneState): Promise<void>;
}

export interface MilestoneConfig {
  mrr: readonly number[];
  sales: readonly number[];
  /** Sales that happened before this server started counting, so an existing business does not get a false "first sale". */
  initialSales: number;
}

export const emptyState = (): MilestoneState => ({ sales: 0, salesSeeded: false, firedSales: [], mrrSeeded: false, firedMrr: [] });

export function ordinal(n: number): string {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n.toLocaleString("en-US")}${suffix}`;
}

/** "1000,100" -> [100, 1000]. `none` disables; unset uses the fallback. */
export function parseThresholds(raw: string | undefined, name: string, fallback: readonly number[]): number[] {
  const text = raw?.trim();
  if (!text) return [...fallback];
  if (text.toLowerCase() === "none") return [];
  const values = text.split(",").map((part) => Number(part.trim()));
  if (values.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error(`${name} must be a comma-separated list of positive numbers, got "${text}"`);
  return [...new Set(values)].sort((a, b) => a - b);
}

export const saleMilestone = (count: number): Milestone =>
  count === 1 ? { kind: "first_sale", title: "🎉 First sale!" } : { kind: "sales", title: `🎉 ${ordinal(count)} sale!` };

export const mrrMilestone = (major: number, currency: string): Milestone => ({
  kind: "mrr",
  title: `🎉 MRR crossed ${formatAmount(minorUnits(major, currency), currency)}!`,
});

/**
 * A signed, test-mode-only event that previews a milestone in every channel without touching
 * the real counters (`npm run simulate -- --mrr 5000`). Returns null for anything else.
 */
export function parseSimulatedMilestone(event: unknown): Milestone | null {
  const e = event as { type?: unknown; livemode?: unknown; data?: { object?: Record<string, unknown> } } | null;
  const o = e?.data?.object;
  if (e?.type !== "mrrgong.simulate.milestone" || e.livemode !== false || typeof o !== "object" || o === null) return null;
  if (o.kind === "mrr" && typeof o.amount === "number" && o.amount > 0 && typeof o.currency === "string" && /^[a-z]{3}$/i.test(o.currency)) {
    return mrrMilestone(o.amount, o.currency.toUpperCase());
  }
  if (o.kind === "sales" && typeof o.count === "number" && Number.isInteger(o.count) && o.count > 0) return saleMilestone(o.count);
  return null;
}

export function nextSaleMilestone(state: MilestoneState, thresholds: readonly number[]): { state: MilestoneState; milestone?: Milestone } {
  const sales = state.sales + 1;
  const next: MilestoneState = { ...state, sales, salesSeeded: true };
  if (!thresholds.includes(sales) || state.firedSales.includes(sales)) return { state: next };
  next.firedSales = [...state.firedSales, sales];
  return { state: next, milestone: saleMilestone(sales) };
}

export function nextMrrMilestone(
  state: MilestoneState,
  mrrMinor: number,
  currency: string,
  thresholds: readonly number[],
): { state: MilestoneState; milestone?: Milestone } {
  const crossed = thresholds.filter((major) => mrrMinor >= minorUnits(major, currency));
  const fresh = crossed.filter((major) => !state.firedMrr.includes(major));
  const next: MilestoneState = { ...state, mrrSeeded: true, firedMrr: [...new Set([...state.firedMrr, ...crossed])].sort((a, b) => a - b) };
  // First reading ever: that is history, not news.
  if (!state.mrrSeeded || fresh.length === 0) return { state: next };
  const top = fresh[fresh.length - 1] as number;
  return { state: next, milestone: mrrMilestone(top, currency) };
}

export function memoryMilestoneStore(): MilestoneStore {
  let state = emptyState();
  return {
    async load() {
      return structuredClone(state);
    },
    async save(next) {
      state = structuredClone(next);
    },
  };
}

function sanitize(parsed: unknown): MilestoneState {
  const out = emptyState();
  if (typeof parsed !== "object" || parsed === null) return out;
  const p = parsed as Record<string, unknown>;
  const numbers = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : []);
  if (typeof p.sales === "number" && Number.isFinite(p.sales)) out.sales = p.sales;
  out.salesSeeded = p.salesSeeded === true;
  out.mrrSeeded = p.mrrSeeded === true;
  out.firedSales = numbers(p.firedSales);
  out.firedMrr = numbers(p.firedMrr);
  return out;
}

export function fileMilestoneStore(file: string): MilestoneStore {
  return {
    async load() {
      try {
        return sanitize(JSON.parse(await readFile(file, "utf8")));
      } catch {
        return emptyState();
      }
    },
    async save(state) {
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, file); // atomic, so a crash never leaves a half-written file
    },
  };
}

/** Workers KV is eventually consistent, so two sales in the same second can race; at worst a milestone is missed or repeated once. */
export function kvMilestoneStore(kv: KvLike, key = "mrrgong:milestones"): MilestoneStore {
  return {
    async load() {
      try {
        const raw = await kv.get(key);
        return raw ? sanitize(JSON.parse(raw)) : emptyState();
      } catch {
        return emptyState();
      }
    },
    async save(state) {
      await kv.put(key, JSON.stringify(state));
    },
  };
}

export interface MilestoneTracker {
  /** Call once per celebrated live sale. */
  recordSale(): Promise<Milestone | undefined>;
  /** Call with each fresh MRR reading. */
  recordMrr(mrrMinor: number, currency: string): Promise<Milestone | undefined>;
}

/** Serialises updates, and never lets a failing store break a sale. */
export function createMilestoneTracker(store: MilestoneStore, config: MilestoneConfig, log: (message: string) => void = () => {}): MilestoneTracker {
  let chain: Promise<unknown> = Promise.resolve();

  function update(step: (state: MilestoneState) => { state: MilestoneState; milestone?: Milestone }): Promise<Milestone | undefined> {
    const run = async () => {
      try {
        const loaded = await store.load();
        const { state, milestone } = step(loaded);
        await store.save(state);
        return milestone;
      } catch (err) {
        log(`milestones: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
    };
    const result = chain.then(run, run);
    chain = result;
    return result;
  }

  return {
    // No thresholds, nothing to track: don't spend a store write (a KV put) on every sale.
    recordSale: () =>
      config.sales.length === 0 ? Promise.resolve(undefined) : update((loaded) => {
        const state = loaded.salesSeeded ? loaded : { ...loaded, sales: config.initialSales, salesSeeded: true };
        return nextSaleMilestone(state, config.sales);
      }),
    recordMrr: (mrrMinor, currency) => config.mrr.length === 0 ? Promise.resolve(undefined) : update((state) => nextMrrMilestone(state, mrrMinor, currency, config.mrr)),
  };
}
