import { describe, expect, it } from "vitest";
import { batchToCsv, runPool, type BatchItem } from "../lib/batch";
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

describe("batchToCsv", () => {
  function item(name: string, partial: Partial<BatchItem>): BatchItem {
    return { id: name, file: { name } as File, previewUrl: "", status: "done", ...partial };
  }

  it("emits a header plus one row per item, including errored rows", () => {
    const items: BatchItem[] = [
      item("a.png", {
        result: {
          mock: false,
          extraction: {} as never,
          report: report({
            compliant: false,
            checks: [
              { key: "netContents", label: "Net Contents", description: "", status: "fail", value: null, confidence: 0.9, reason: "" },
            ],
            summary: "1 required element failed.",
          }),
        },
      }),
      item("b.png", { status: "error", error: "Rate limited", result: undefined }),
    ];
    const csv = batchToCsv(items);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toMatch(/^filename,status,beverage_type/);
    expect(lines[1]).toContain("Not compliant");
    expect(lines[1]).toContain("Net Contents");
    expect(lines[2]).toContain("Rate limited");
  });

  it("escapes commas and quotes per RFC 4180", () => {
    const items: BatchItem[] = [
      item('we, the "best".png', {
        result: {
          mock: false,
          extraction: {} as never,
          report: report({ compliant: true, summary: "All good, really." }),
        },
      }),
    ];
    const row = batchToCsv(items).split("\r\n")[1];
    expect(row).toContain('"we, the ""best"".png"');
    expect(row).toContain('"All good, really."');
  });
});
