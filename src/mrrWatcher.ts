import { readFile, rename, writeFile } from "node:fs/promises";
import { minorUnits } from "./sale.ts";
import { computeMrr, fetchActiveSubscriptions, mrrSummary, recordSnapshot, type MrrSummary, type Snapshot } from "./mrr.ts";

export interface MrrWatcherOptions {
  apiKey: string;
  goalMajor?: number;
  historyFile: string;
  fetch?: typeof fetch;
  now?: () => Date;
  onUpdate?: (summary: MrrSummary) => void;
  log?: (message: string) => void;
}

export interface MrrWatcher {
  /** Re-reads Stripe, records today's snapshot, and returns the summary. */
  refresh(): Promise<MrrSummary | null>;
  current(): MrrSummary | null;
}

async function loadHistory(file: string): Promise<Snapshot[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter((s): s is Snapshot => typeof s?.date === "string" && typeof s?.mrrMinor === "number" && typeof s?.currency === "string")
      : [];
  } catch {
    return [];
  }
}

async function saveHistory(file: string, history: Snapshot[]): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(history));
  await rename(tmp, file); // atomic, so a crash never leaves a half-written history
}

export function createMrrWatcher(options: MrrWatcherOptions): MrrWatcher {
  const { apiKey, historyFile, log = () => {}, now = () => new Date() } = options;
  const fetchImpl = options.fetch ?? fetch;
  let latest: MrrSummary | null = null;
  let inflight: Promise<MrrSummary | null> | null = null;

  async function run(): Promise<MrrSummary | null> {
    const totals = computeMrr(await fetchActiveSubscriptions(apiKey, fetchImpl));
    // Multi-currency accounts: track the biggest currency rather than adding apples to oranges.
    const [currency, mrrMinor] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] ?? ["USD", 0];
    const today = now().toISOString().slice(0, 10);
    const history = recordSnapshot(await loadHistory(historyFile), { date: today, mrrMinor, currency });
    await saveHistory(historyFile, history);
    const goalMinor = options.goalMajor ? minorUnits(options.goalMajor, currency) : undefined;
    latest = mrrSummary(history, today, goalMinor);
    if (latest) options.onUpdate?.(latest);
    return latest;
  }

  return {
    // Share one in-flight request so a burst of sales does not hammer Stripe.
    refresh() {
      inflight ??= run()
        .catch((err: unknown) => {
          log(`mrr refresh failed: ${err instanceof Error ? err.message : String(err)}`);
          return latest;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    current: () => latest,
  };
}
