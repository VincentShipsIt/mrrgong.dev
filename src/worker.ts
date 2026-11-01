/** Cloudflare Workers entry. Set secrets with `wrangler secret put STRIPE_WEBHOOK_SECRET` etc. */
import { loadConfig, type Env } from "./config.ts";
import { createHandler, memoryDedupe } from "./handler.ts";

// Isolates are reused, so this dedupes within an isolate's lifetime (best effort).
const dedupe = memoryDedupe();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return new Response("ok");
    if (pathname !== "/webhook") return new Response("not found", { status: 404 });
    let config;
    try {
      config = loadConfig(env);
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "bad config", { status: 500 });
    }
    return createHandler({ config, dedupe, log: console.error })(request);
  },
};
