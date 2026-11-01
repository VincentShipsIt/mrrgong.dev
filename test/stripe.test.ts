import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "../src/stripe.ts";

const secret = "whsec_test";
const body = '{"id":"evt_1"}';
const now = 1_700_000_000;
const sign = (t: number, payload = body, s = secret) =>
  createHmac("sha256", s).update(`${t}.${payload}`).digest("hex");

describe("verifyStripeSignature", () => {
  it("accepts a valid signature", async () => {
    const header = `t=${now},v1=${sign(now)}`;
    expect(await verifyStripeSignature(body, header, secret, 300, now)).toBe(true);
  });

  it("accepts when any of several v1 signatures matches (secret rotation)", async () => {
    const header = `t=${now},v1=${"0".repeat(64)},v1=${sign(now)}`;
    expect(await verifyStripeSignature(body, header, secret, 300, now)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const header = `t=${now},v1=${sign(now)}`;
    expect(await verifyStripeSignature(body + " ", header, secret, 300, now)).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const header = `t=${now},v1=${sign(now, body, "whsec_other")}`;
    expect(await verifyStripeSignature(body, header, secret, 300, now)).toBe(false);
  });

  it("rejects a stale timestamp (replay)", async () => {
    const header = `t=${now - 301},v1=${sign(now - 301)}`;
    expect(await verifyStripeSignature(body, header, secret, 300, now)).toBe(false);
  });

  it("rejects timestamps from the future beyond tolerance", async () => {
    const header = `t=${now + 301},v1=${sign(now + 301)}`;
    expect(await verifyStripeSignature(body, header, secret, 300, now)).toBe(false);
  });

  it.each([null, "", "garbage", "t=abc,v1=00", `v1=${"0".repeat(64)}`, `t=${now}`])(
    "rejects malformed header %j",
    async (header) => {
      expect(await verifyStripeSignature(body, header, secret, 300, now)).toBe(false);
    },
  );

  it("rejects a non-hex or wrong-length signature without throwing", async () => {
    expect(await verifyStripeSignature(body, `t=${now},v1=zz`, secret, 300, now)).toBe(false);
  });
});
