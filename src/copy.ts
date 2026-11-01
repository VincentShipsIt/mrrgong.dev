import type { Mode, Tier } from "./types.ts";

/**
 * Message copy per mode. Contributors: add lines here (and a mode in `types.ts`) via PR.
 * Keep it customer-free, and keep film titles, quotes and other companies' brands out.
 */
export const LINES: Record<Exclude<Mode, "calm">, Record<Tier, string[]>> = {
  indie: {
    normal: [
      "MRR go brrr.",
      "A stranger on the internet just paid you.",
      "Ship it. Someone bought it.",
      "Stripe says nice.",
      "Not a bug, a customer.",
      "Another one for the build-in-public thread.",
      "Your side project has a customer.",
      "Real money from a real person.",
      "The landing page is working.",
      "Add it to the screenshot folder.",
      "Cha-ching, but make it a SaaS.",
    ],
    big: [
      "Okay, that is a real customer.",
      "Touch grass later. Count money now.",
      "This one pays for the servers.",
      "Time to update the revenue tweet.",
      "Somebody read the pricing page.",
      "That is a good day's work.",
      "The side project is getting serious.",
      "Pricing page: validated.",
      "Coffee is on the customer today.",
      "Do not refresh Stripe. Okay, refresh once.",
    ],
    huge: [
      "Quit-your-job energy.",
      "Tell your mom. Then tell the group chat.",
      "That is a rent payment.",
      "The spreadsheet has to be updated.",
      "Close the laptop. Celebrate. Reopen the laptop.",
      "Frame this notification.",
      "Somebody believed in you at scale.",
      "Pop the good coffee.",
      "A new personal best, probably.",
      "Screenshot it before it feels fake.",
    ],
  },
  broker: {
    normal: [
      "Another deal closed.",
      "The phones are ringing.",
      "Sold.",
      "Put it on the board.",
      "That is how it is done.",
      "Smile and dial pays off.",
      "Trade confirmed.",
      "The desk is on fire.",
      "Closed and logged.",
      "Always be closing.",
      "One more for the leaderboard.",
    ],
    big: [
      "Big fish on the line.",
      "That is a closer's close.",
      "The whole floor heard that one.",
      "Commission-sized sale.",
      "Pitch landed, wallet opened.",
      "That one gets a speech.",
      "Order up, and it is a big one.",
      "Top of the board, easy.",
      "Do not let the competition see this.",
      "Ring it twice.",
    ],
    huge: [
      "Whale on the hook.",
      "Drinks are on the desk tonight.",
      "Corner-office numbers.",
      "Retire the old record.",
      "Everybody stand up.",
      "That is a quarter's target in one call.",
      "Clear the room, we have a winner.",
      "Gold-plated close.",
      "Hold the applause. No, do not hold it.",
      "Put it in the hall of fame.",
    ],
  },
};

export const MILESTONE_LINES: Record<Mode, string[]> = {
  calm: [],
  indie: [
    "Number go up. Number went up.",
    "Build in public, win in public.",
    "Remember when this was zero?",
    "Write the thread. You earned it.",
    "The graph is doing graph things.",
  ],
  broker: [
    "The board just lit up.",
    "New record on the floor.",
    "Everybody on the desk stands up.",
    "Call the old guard and brag.",
    "That is how legends start.",
  ],
};

export const SAD_LINES: Record<Mode, string[]> = {
  calm: [],
  indie: [
    "Churn is just the market giving feedback.",
    "It happens to everyone. Check the exit survey.",
    "One step back, two steps forward.",
    "Do not read the reason at midnight.",
  ],
  broker: [
    "A deal fell through. Next call.",
    "Even the best desks lose a few.",
    "Shake it off and get back on the phones.",
    "Write it down and move on.",
  ],
};

/**
 * Picks a line from a pool, never the same one twice in a row for the same key.
 * `rng` is injectable so tests are deterministic.
 */
export function createPicker(rng: () => number = Math.random): (pool: readonly string[], key: string) => string | undefined {
  const last = new Map<string, number>();
  return (pool, key) => {
    if (pool.length === 0) return undefined;
    let index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    if (pool.length > 1 && index === last.get(key)) index = (index + 1) % pool.length;
    last.set(key, index);
    return pool[index];
  };
}
