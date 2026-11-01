#!/usr/bin/env node
import { loadConfig } from "./config.ts";
import { createGongServer } from "./server.ts";

try {
  const config = loadConfig(process.env);
  const port = Number(process.env.PORT ?? 8787);
  const token = process.env.GONG_TOKEN || undefined;
  const server = createGongServer({ config, token, log: (m) => console.error(`[mrrgong] ${m}`) });
  server.listen(port, () => {
    console.log(`🔔 mrrgong listening on :${port}`);
    console.log(`   Stripe webhook → /webhook   Browser gong → /gong${token ? "?token=…" : ""}`);
    if (!config.discordWebhookUrl && !config.slackWebhookUrl) console.log("   (no Discord/Slack webhook set: browser gong only)");
  });
} catch (err) {
  console.error(`[mrrgong] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
