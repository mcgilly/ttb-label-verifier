import { describe, expect, it } from "vitest";
import { runPool } from "../lib/batch";
import { deriveVerdict } from "../lib/compliance";
import type { ComplianceReport } from "../lib/compliance";

describe("runPool", () => {
  it("processes every item with bounded concurrency", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const processed: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    await runPool(items, 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      processed.push(n);
      inFlight--;
    });

    expect(processed.sort((a, b) => a - b)).toEqual(items);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // actually ran concurrently
  });

  it("when the worker catches its own errors (as the app does), every item is processed", async () => {
    const items = [1, 2, 3, 4];
    const done: number[] = [];
    const failed: number[] = [];
    // Mirrors BatchPanel: the worker try/catches so one bad item can't abort the pool.
    await runPool(items, 2, async (n) => {
      try {
        if (n === 2) throw new Error("boom");
        done.push(n);
      } catch {
        failed.push(n);
      }
    });
    expect(done.sort((a, b) => a - b)).toEqual([1, 3, 4]);
    expect(failed).toEqual([2]);
  });
});

function report(partial: Partial<ComplianceReport>): ComplianceReport {
  return {
    beverageType: "spirits",
    isImport: false,
    imageQuality: { readable: true, issues: [], note: "" },
    compliant: false,
    hasUncertainty: false,
    checks: [],
    summary: "",
    ...partial,
  };
}

describe("deriveVerdict", () => {
  it("returns compliant when the report is compliant", () => {
    expect(deriveVerdict(report({ compliant: true }))).toBe("compliant");
  });

  it("returns unreadable when the image is not readable", () => {
    expect(
      deriveVerdict(report({ imageQuality: { readable: false, issues: ["blur"], note: "" } })),
    ).toBe("unreadable");
  });

  it("returns review when uncertain but nothing failed", () => {
    const r = report({
      hasUncertainty: true,
      checks: [
        { key: "brandName", label: "Brand", description: "", status: "uncertain", value: null, confidence: 0.4, reason: "" },
      ],
    });
    expect(deriveVerdict(r)).toBe("review");
  });

  it("returns noncompliant when something failed", () => {
    const r = report({
      checks: [
        { key: "netContents", label: "Net", description: "", status: "fail", value: null, confidence: 0.9, reason: "" },
      ],
    });
    expect(deriveVerdict(r)).toBe("noncompliant");
  });
});
