/**
 * Cloudflare Workers entry. Set secrets with `wrangler secret put STRIPE_WEBHOOK_SECRET` etc.
 * Bind a KV namespace as `DEDUPE` (see wrangler.toml) so retried events are announced once
 * even across isolates; without it, dedupe is per isolate and best effort.
 */
import { loadConfig, type Env } from "./config.ts";
import { fallbackDedupe, kvDedupe, memoryDedupe, type KvLike } from "./dedupe.ts";
import { createHandler } from "./handler.ts";

export type WorkerEnv = { DEDUPE?: KvLike } & Record<string, string | KvLike | undefined>;

// Isolates are reused, so this always backs up the KV store.
const memory = memoryDedupe();

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return new Response("ok");
    if (pathname !== "/webhook") return new Response("not found", { status: 404 });
    let config;
    try {
      config = loadConfig(env as Env);
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "bad config", { status: 500 });
    }
    const log = console.error;
    const dedupe = env.DEDUPE ? fallbackDedupe(kvDedupe(env.DEDUPE), memory, log) : memory;
    return createHandler({ config, dedupe, log })(request);
  },
};
