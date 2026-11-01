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

  it("treats empty strings as unset", () => {
    const c = loadConfig({ ...base, SLACK_WEBHOOK_URL: "", GONG_BIG_AT: "" });
    expect(c.slackWebhookUrl).toBeUndefined();
    expect(c.bigAt).toBe(100);
  });
});
