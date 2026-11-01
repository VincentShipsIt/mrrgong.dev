import { describe, expect, it } from "vitest";
import { LINES, MILESTONE_LINES, SAD_LINES, createPicker } from "../src/copy.ts";

describe("copy sets", () => {
  it.each(Object.entries(LINES))("%s mode has at least 10 distinct lines for every tier", (_mode, tiers) => {
    for (const lines of Object.values(tiers)) {
      expect(lines.length).toBeGreaterThanOrEqual(10);
      expect(new Set(lines).size).toBe(lines.length);
    }
  });

  it("keeps lines short, single-line, and free of mentions, links and brand names", () => {
    const all = [
      ...Object.values(LINES).flatMap((t) => Object.values(t).flat()),
      ...Object.values(MILESTONE_LINES).flat(),
      ...Object.values(SAD_LINES).flat(),
    ];
    for (const line of all) {
      expect(line.length).toBeLessThanOrEqual(80);
      expect(line).not.toMatch(/[\n@<>]|https?:/);
      expect(line.toLowerCase()).not.toMatch(/wolf|wall street|belfort|stratton|gong\.io|stripe inc/);
    }
  });

  it("calm mode has no extra lines (today's behaviour)", () => {
    expect(MILESTONE_LINES.calm).toEqual([]);
    expect(SAD_LINES.calm).toEqual([]);
  });
});

describe("createPicker", () => {
  it("returns undefined for an empty pool", () => {
    expect(createPicker()([], "k")).toBeUndefined();
  });
  it("never repeats the same line back to back, even when the rng does", () => {
    const pick = createPicker(() => 0);
    const pool = ["a", "b", "c"];
    let prev = pick(pool, "k");
    for (let i = 0; i < 20; i++) {
      const next = pick(pool, "k");
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
  it("tracks each key separately", () => {
    const pick = createPicker(() => 0);
    expect(pick(["a", "b"], "one")).toBe("a");
    expect(pick(["a", "b"], "two")).toBe("a");
  });
  it("handles a single-line pool and an rng of exactly 1", () => {
    const pick = createPicker(() => 1);
    expect(pick(["only"], "k")).toBe("only");
    expect(pick(["only"], "k")).toBe("only");
    expect(pick(["a", "b", "c"], "x")).toBe("c");
  });
});
