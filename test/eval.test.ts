import { describe, expect, it } from "vitest";
import { aggregate, scoreCase, type Fixture } from "../lib/eval";
import { GOVERNMENT_WARNING_TEXT } from "../lib/ttb-rules";
import type { Extraction, ExtractedField } from "../lib/schema";

function f(value: string | null, confidence = 0.95): ExtractedField {
  return value === null
    ? { present: false, value: null, verbatim: null, confidence }
    : { present: true, value, verbatim: value, confidence };
}

function spiritsExtraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    beverageType: "spirits",
    isImport: false,
    imageQuality: { readable: true, issues: [], note: "" },
    brandName: f("Old Tom Distillery"),
    classType: f("Kentucky Straight Bourbon Whiskey"),
    alcoholContent: f("45% Alc./Vol. (90 Proof)"),
    netContents: f("750 mL"),
    bottlerNameAddress: f("Bottled by Old Tom Distillery, Bardstown, KY"),
    countryOfOrigin: f(null),
    governmentWarning: f(GOVERNMENT_WARNING_TEXT),
    ...overrides,
  };
}

const compliantFixture: Fixture = {
  file: "x.png",
  mediaType: "image/png",
  note: "compliant",
  expect: {
    beverageType: "spirits",
    isImport: false,
    verdict: "compliant",
    warningStatus: "pass",
    fields: {
      brandName: { present: true, value: "OLD TOM DISTILLERY" }, // different case on purpose
      netContents: { present: true, value: "750 mL" },
      governmentWarning: { present: true },
    },
  },
};

describe("scoreCase", () => {
  it("scores a perfect extraction as all-correct, case-insensitive on values", () => {
    const s = scoreCase(spiritsExtraction(), compliantFixture);
    expect(s.mismatches).toEqual([]);
    expect(s.verdictOk).toBe(true);
    expect(s.beverageOk).toBe(true);
    expect(s.presence.correct).toBe(s.presence.total);
    expect(s.values.correct).toBe(s.values.total);
    expect(s.warningOk).toBe(true);
  });

  it("flags a wrong verdict and a missing-field mistake", () => {
    // Model wrongly reports the warning present when the fixture says it should be absent.
    const fixture: Fixture = {
      ...compliantFixture,
      expect: {
        ...compliantFixture.expect,
        verdict: "noncompliant",
        warningStatus: "fail",
        fields: { governmentWarning: { present: false } },
      },
    };
    const s = scoreCase(spiritsExtraction(), fixture);
    expect(s.verdictOk).toBe(false);
    expect(s.warningOk).toBe(false);
    expect(s.mismatches.length).toBeGreaterThan(0);
  });

  it("catches a value that drifts too far from ground truth", () => {
    const fixture: Fixture = {
      ...compliantFixture,
      expect: {
        ...compliantFixture.expect,
        fields: { netContents: { present: true, value: "1 Liter" } },
      },
    };
    const s = scoreCase(spiritsExtraction({ netContents: f("50 mL") }), fixture);
    expect(s.values.correct).toBe(0);
    expect(s.mismatches.some((m) => m.includes("netContents.value"))).toBe(true);
  });
});

describe("aggregate", () => {
  it("computes headline accuracies across cases", () => {
    const good = scoreCase(spiritsExtraction(), compliantFixture);
    const bad = scoreCase(spiritsExtraction({ governmentWarning: f(null) }), compliantFixture);
    const summary = aggregate([good, bad]);
    expect(summary.cases).toBe(2);
    expect(summary.verdictAccuracy).toBe(0.5); // one compliant-correct, one now noncompliant
    expect(summary.beverageAccuracy).toBe(1);
  });
});
