export async function postJson(fetchImpl: typeof fetch, url: string, body: unknown, headers: Record<string, string> = {}, label = "webhook"): Promise<void> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${label} responded ${res.status}`);
}
