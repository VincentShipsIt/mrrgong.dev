import { details, headline } from "./format.ts";
import { postJson } from "./http.ts";
import { SAD_KINDS, type CustomerVisibility, type Milestone, type Sale, type Sink, type Tier } from "./types.ts";

const PRIORITY: Record<Tier, number> = { normal: 3, big: 4, huge: 5 };
const SAD_PRIORITY = 2;
const MILESTONE_PRIORITY = 4;

export function ntfySalePayload(topic: string, sale: Sale, tier: Tier, visibility: CustomerVisibility) {
  const sad = SAD_KINDS.has(sale.kind);
  const body = details(sale, visibility);
  return {
    topic,
    title: headline(sale, tier),
    ...(body ? { message: body } : {}),
    priority: sad ? SAD_PRIORITY : PRIORITY[tier],
    tags: [sad ? "droplet" : "bell"],
  };
}

export function ntfyMilestonePayload(topic: string, milestone: Milestone) {
  return { topic, title: `🔔 ${milestone.title}`, priority: MILESTONE_PRIORITY, tags: ["tada"] };
}

/** Push notifications to your phone through ntfy (ntfy.sh or self-hosted). JSON publish to the server root. */
export function ntfySink(server: string, topic: string, visibility: CustomerVisibility, fetchImpl: typeof fetch): Sink {
  const url = server.replace(/\/+$/, "");
  return Object.assign((sale: Sale, tier: Tier) => postJson(fetchImpl, url, ntfySalePayload(topic, sale, tier, visibility), {}, "ntfy"), {
    milestone: (m: Milestone) => postJson(fetchImpl, url, ntfyMilestonePayload(topic, m), {}, "ntfy"),
  });
}
