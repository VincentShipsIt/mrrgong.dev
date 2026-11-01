import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { customerLabel } from "./format.ts";
import { GONG_PAGE } from "./gongPage.ts";
import { createHandler, memoryDedupe } from "./handler.ts";
import { formatAmount } from "./sale.ts";
import type { GongConfig, Sink } from "./types.ts";

export interface ServerOptions {
  config: GongConfig;
  /** If set, /gong and /events require ?token=... */
  token?: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

const MAX_BODY = 1_000_000; // Stripe events are a few KB; refuse anything silly.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createGongServer(options: ServerOptions): Server {
  const { config, token, log = () => {} } = options;
  const clients = new Set<ServerResponse>();

  const browserSink: Sink = async (sale, tier) => {
    const payload = JSON.stringify({
      amount: formatAmount(sale.amountMinor, sale.currency),
      tier,
      kind: sale.kind,
      label: customerLabel(sale, config.customer),
    });
    for (const res of clients) res.write(`data: ${payload}\n\n`);
  };

  const handle = createHandler({
    config,
    fetch: options.fetch,
    dedupe: memoryDedupe(),
    extraSinks: [browserSink],
    log,
  });

  const authorised = (url: URL) => !token || safeEqual(url.searchParams.get("token") ?? "", token);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }

    if (url.pathname === "/webhook") {
      const body = await readBody(req);
      if (!body) {
        res.writeHead(413).end("too large");
        return;
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const out = await handle(new Request("http://localhost/webhook", { method: req.method, headers, body: req.method === "POST" ? body.toString("utf8") : undefined }));
      res.writeHead(out.status, { "content-type": "text/plain" }).end(await out.text());
      return;
    }

    if (req.method === "GET" && (url.pathname === "/gong" || url.pathname === "/events")) {
      if (!authorised(url)) {
        res.writeHead(401).end("unauthorised");
        return;
      }
      if (url.pathname === "/gong") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(GONG_PAGE);
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    res.writeHead(404).end("not found");
  });
}
