import { majorUnits } from "./sale.ts";
import type { GongEvent, Sink } from "./types.ts";

const encoder = new TextEncoder();

/** RFC 3986 percent-encoding, as OAuth 1.0a requires (encodeURIComponent leaves `!*'()` alone). */
export function percentEncode(text: string): string {
  return encodeURIComponent(text).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface OAuth1Input {
  method: string;
  url: string;
  /** Query and form-encoded body parameters. JSON bodies are not part of the signature. */
  params: Record<string, string>;
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
  nonce?: string;
  timestamp?: string;
}

function oauthParams(input: OAuth1Input): Record<string, string> {
  return {
    oauth_consumer_key: input.consumerKey,
    oauth_nonce: input.nonce ?? crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: input.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: input.token,
    oauth_version: "1.0",
  };
}

async function sign(input: OAuth1Input, oauth: Record<string, string>): Promise<string> {
  const all = { ...input.params, ...oauth };
  const paramString = Object.entries(all)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [input.method.toUpperCase(), percentEncode(input.url), percentEncode(paramString)].join("&");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${percentEncode(input.consumerSecret)}&${percentEncode(input.tokenSecret)}`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(base)));
  return btoa(String.fromCharCode(...mac));
}

export async function oauth1Signature(input: OAuth1Input): Promise<string> {
  return sign(input, oauthParams(input));
}

export async function oauth1Header(input: OAuth1Input): Promise<string> {
  const oauth = oauthParams(input);
  const signature = await sign(input, oauth);
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature })
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ")}`;
}

export interface XOptions {
  creds: { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string };
  /** Major units. Also post ordinary sales at or above this amount. */
  postAllOverMajor?: number;
  fetch?: typeof fetch;
}

const ENDPOINT = "https://api.x.com/2/tweets";
const MAX_LENGTH = 280;

function shouldPost(event: GongEvent, over: number | undefined): boolean {
  if (event.type === "milestone") return true;
  if (event.type === "sale" && over !== undefined) {
    return majorUnits(event.sale.amountMinor, event.sale.currency) >= over;
  }
  return false;
}

/** Public channel: posts only the customer-free `publicText`, milestones by default. */
export function xSink(options: XOptions): Sink {
  const fetchImpl = options.fetch ?? fetch;
  return async (event) => {
    const text = event.message.publicText;
    if (event.type === "sad" || !text || !shouldPost(event, options.postAllOverMajor)) return;
    const authorization = await oauth1Header({
      method: "POST",
      url: ENDPOINT,
      params: {},
      consumerKey: options.creds.apiKey,
      consumerSecret: options.creds.apiSecret,
      token: options.creds.accessToken,
      tokenSecret: options.creds.accessSecret,
    });
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, MAX_LENGTH) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`X responded ${res.status}`);
  };
}
