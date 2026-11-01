import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const base = { STRIPE_WEBHOOK_SECRET: "whsec_x", DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc" };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ bigAt: 100, hugeAt: 1000, celebrateRenewals: true, customer: "masked", toleranceSeconds: 300 });
  });

  it("requires the webhook secret", () => {
    expect(() => loadConfig({ DISCORD_WEBHOOK_URL: base.DISCORD_WEBHOOK_URL })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("allows running with only the browser gong (no chat sinks)", () => {
    expect(() => loadConfig({ STRIPE_WEBHOOK_SECRET: "whsec_x" })).not.toThrow();
  });

  it("parses overrides", () => {
    const c = loadConfig({
      ...base,
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/x",
      GONG_BIG_AT: "50",
      GONG_HUGE_AT: "500",
      GONG_RENEWALS: "false",
      GONG_CUSTOMER: "none",
    });
    expect(c).toMatchObject({ bigAt: 50, hugeAt: 500, celebrateRenewals: false, customer: "none" });
    expect(c.slackWebhookUrl).toContain("hooks.slack.com");
  });

  it("rejects bad numbers and bad enums", () => {
    expect(() => loadConfig({ ...base, GONG_BIG_AT: "lots" })).toThrow(/GONG_BIG_AT/);
    expect(() => loadConfig({ ...base, GONG_BIG_AT: "-1" })).toThrow(/GONG_BIG_AT/);
    expect(() => loadConfig({ ...base, GONG_CUSTOMER: "everything" })).toThrow(/GONG_CUSTOMER/);
    expect(() => loadConfig({ ...base, GONG_BIG_AT: "500", GONG_HUGE_AT: "100" })).toThrow(/GONG_HUGE_AT/);
  });

  it("only accepts real Discord and Slack webhook hosts (no SSRF via config typos)", () => {
    expect(() => loadConfig({ ...base, DISCORD_WEBHOOK_URL: "https://evil.example/hook" })).toThrow(/DISCORD_WEBHOOK_URL/);
    expect(() => loadConfig({ ...base, SLACK_WEBHOOK_URL: "http://hooks.slack.com/services/x" })).toThrow(/SLACK_WEBHOOK_URL/);
    expect(() => loadConfig({ ...base, DISCORD_WEBHOOK_URL: "not a url" })).toThrow(/DISCORD_WEBHOOK_URL/);
  });

  it("parses the optional MRR watcher settings", () => {
    const c = loadConfig({ ...base, STRIPE_API_KEY: "rk_live_abc", MRR_GOAL: "2000", MRR_POLL_MINUTES: "5" });
    expect(c).toMatchObject({ stripeApiKey: "rk_live_abc", mrrGoal: 2000, mrrPollMinutes: 5 });
    expect(loadConfig(base)).toMatchObject({ stripeApiKey: undefined, mrrGoal: undefined, mrrPollMinutes: 15 });
  });

  it("rejects obviously wrong Stripe API keys and poll intervals", () => {
    expect(() => loadConfig({ ...base, STRIPE_API_KEY: "whsec_nope" })).toThrow(/STRIPE_API_KEY/);
    expect(() => loadConfig({ ...base, MRR_POLL_MINUTES: "0" })).toThrow(/MRR_POLL_MINUTES/);
  });

  it("parses mode, sad and milestone flags", () => {
    expect(loadConfig(base)).toMatchObject({ mode: "calm", sad: false, milestones: true });
    expect(loadConfig({ ...base, GONG_MODE: "Indie", GONG_SAD: "true", GONG_MILESTONES: "off" })).toMatchObject({ mode: "indie", sad: true, milestones: false });
    expect(() => loadConfig({ ...base, GONG_MODE: "wolf" })).toThrow(/GONG_MODE/);
    expect(() => loadConfig({ ...base, GONG_SAD: "maybe" })).toThrow(/GONG_SAD/);
  });

  it("parses ntfy and validates it", () => {
    expect(loadConfig(base)).toMatchObject({ ntfyTopic: undefined, ntfyServer: "https://ntfy.sh" });
    expect(loadConfig({ ...base, NTFY_TOPIC: "my-gong_1", NTFY_SERVER: "https://ntfy.example.com" })).toMatchObject({ ntfyTopic: "my-gong_1", ntfyServer: "https://ntfy.example.com" });
    expect(() => loadConfig({ ...base, NTFY_SERVER: "http://ntfy.sh" })).toThrow(/NTFY_SERVER/);
    expect(() => loadConfig({ ...base, NTFY_SERVER: "nope" })).toThrow(/NTFY_SERVER/);
    expect(() => loadConfig({ ...base, NTFY_TOPIC: "../etc/passwd" })).toThrow(/NTFY_TOPIC/);
  });

  it("requires all four X credentials or none", () => {
    const x = { X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" };
    expect(loadConfig(base).x).toBeUndefined();
    expect(loadConfig({ ...base, ...x, X_POST_ALL_OVER: "250" })).toMatchObject({ x: { apiKey: "a", apiSecret: "b", accessToken: "c", accessSecret: "d" }, xPostAllOver: 250 });
    expect(() => loadConfig({ ...base, X_API_KEY: "a" })).toThrow(/X_API_SECRET/);
  });

  it("parses the optional AI writer settings", () => {
    expect(loadConfig(base)).toMatchObject({ anthropicApiKey: undefined, aiModel: "claude-haiku-5-5" });
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: "sk-ant-x", GONG_AI_MODEL: "claude-sonnet-5-5" })).toMatchObject({ anthropicApiKey: "sk-ant-x", aiModel: "claude-sonnet-5-5" });
  });

  it("treats empty strings as unset", () => {
    const c = loadConfig({ ...base, SLACK_WEBHOOK_URL: "", GONG_BIG_AT: "" });
    expect(c.slackWebhookUrl).toBeUndefined();
    expect(c.bigAt).toBe(100);
  });
});
