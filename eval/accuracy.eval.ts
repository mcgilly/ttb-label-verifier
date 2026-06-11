import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FIXTURES } from "./fixtures";
import { extractLabel } from "../lib/extract";
import { runPool } from "../lib/batch";
import {
  aggregate,
  formatReport,
  scoreCase,
  type CaseScore,
  type EvalSummary,
} from "../lib/eval";

/**
 * Accuracy eval against real Claude vision. Run with `npm run eval` (needs
 * ANTHROPIC_API_KEY). Each fixture image is extracted, run through the real
 * compliance pipeline, and scored against ground truth; the suite then asserts
 * headline accuracy thresholds so this doubles as a regression gate.
 */
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const suite = hasKey ? describe : describe.skip;

suite("accuracy eval (real Claude vision)", () => {
  let scores: CaseScore[] = [];
  let summary: EvalSummary;

  beforeAll(async () => {
    scores = new Array(FIXTURES.length);
    await runPool(FIXTURES, 3, async (fx, i) => {
      const base64 = readFileSync(join(process.cwd(), "sample-labels", fx.file)).toString("base64");
      const extraction = await extractLabel(base64, fx.mediaType);
      scores[i] = scoreCase(extraction, fx);
    });
    summary = aggregate(scores);
    console.log(formatReport(scores, summary));
  });

  it("classifies the beverage type correctly", () => {
    expect(summary.beverageAccuracy).toBeGreaterThanOrEqual(0.8);
  });

  it("reaches the right compliance verdict", () => {
    expect(summary.verdictAccuracy).toBeGreaterThanOrEqual(0.8);
  });

  it("detects required fields reliably (incl. on the glare/angle photo)", () => {
    expect(summary.fieldPresenceAccuracy).toBeGreaterThanOrEqual(0.9);
  });

  it("catches every missing or altered Government Warning", () => {
    expect(summary.warningCheckAccuracy).toBe(1);
  });
});

if (!hasKey) {
  // Surface why the eval was skipped instead of silently passing 0 tests.
  describe("accuracy eval", () => {
    it.skip("skipped — set ANTHROPIC_API_KEY (or .env.local) to run", () => {});
  });
}
