/**
 * Cloudflare Workers entry. Set secrets with `wrangler secret put STRIPE_WEBHOOK_SECRET` etc.
 * Bind a KV namespace as `GONG_KV` to keep dedupe keys and milestone counters across isolates.
 */
import { loadConfig, type Env } from "./config.ts";
import { createHandler } from "./handler.ts";
import { kvState, memoryState, type KVLike } from "./state.ts";
import { createWriter } from "./writer.ts";

// Isolates are reused, so without KV this dedupes within an isolate's lifetime (best effort).
const fallbackState = memoryState();

/** Workers bindings: plain-string variables and secrets, plus an optional KV namespace. */
export type WorkerEnv = Record<string, unknown> & { GONG_KV?: KVLike };

const stringsOnly = (env: WorkerEnv): Env =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return new Response("ok");
    if (pathname !== "/webhook") return new Response("not found", { status: 404 });
    let config;
    try {
      config = loadConfig(stringsOnly(env));
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "bad config", { status: 500 });
    }
    return createHandler({
      config,
      state: env.GONG_KV ? kvState(env.GONG_KV) : fallbackState,
      writer: config.anthropicApiKey ? createWriter({ apiKey: config.anthropicApiKey, model: config.aiModel }) : undefined,
      log: console.error,
    })(request);
  },
};
