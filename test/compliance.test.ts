import { describe, expect, it } from "vitest";
import { evaluateCompliance, normalize, textSimilarity } from "../lib/compliance";
import { GOVERNMENT_WARNING_TEXT } from "../lib/ttb-rules";
import type { Extraction, ExtractedField } from "../lib/schema";

function field(overrides: Partial<ExtractedField> = {}): ExtractedField {
  return { present: true, value: "x", verbatim: "x", confidence: 0.95, ...overrides };
}

function absent(): ExtractedField {
  return { present: false, value: null, verbatim: null, confidence: 0.9 };
}

/** A fully-compliant distilled-spirits label (matches the brief's sample). */
function compliantSpirits(overrides: Partial<Extraction> = {}): Extraction {
  return {
    beverageType: "spirits",
    isImport: false,
    imageQuality: { readable: true, issues: [], note: "clear" },
    brandName: field({ value: "OLD TOM DISTILLERY" }),
    classType: field({ value: "Kentucky Straight Bourbon Whiskey" }),
    alcoholContent: field({ value: "45% Alc./Vol. (90 Proof)" }),
    netContents: field({ value: "750 mL" }),
    bottlerNameAddress: field({ value: "Bottled by Old Tom Distillery, Bardstown, KY" }),
    countryOfOrigin: absent(),
    governmentWarning: field({ value: GOVERNMENT_WARNING_TEXT, verbatim: GOVERNMENT_WARNING_TEXT }),
    ...overrides,
  };
}

describe("normalize / textSimilarity", () => {
  it("treats case and whitespace differences as identical", () => {
    expect(normalize("750  mL")).toBe(normalize("750 ml"));
    expect(textSimilarity("750 mL", "750 ML")).toBe(1);
  });

  it("scores the exact government warning as a perfect match", () => {
    expect(textSimilarity(GOVERNMENT_WARNING_TEXT, GOVERNMENT_WARNING_TEXT)).toBe(1);
  });

  it("drops sharply when a warning clause is altered", () => {
    const altered = GOVERNMENT_WARNING_TEXT.replace(
      "should not drink alcoholic beverages during pregnancy",
      "can drink alcoholic beverages during pregnancy",
    );
    const sim = textSimilarity(altered, GOVERNMENT_WARNING_TEXT);
    expect(sim).toBeLessThan(0.97);
    expect(sim).toBeGreaterThan(0.55);
  });
});

describe("evaluateCompliance — happy path", () => {
  it("passes a fully compliant spirits label", () => {
    const report = evaluateCompliance(compliantSpirits());
    expect(report.compliant).toBe(true);
    expect(report.hasUncertainty).toBe(false);
    expect(report.checks.every((c) => c.status === "pass")).toBe(true);
    // No country-of-origin requirement for a domestic product.
    expect(report.checks.find((c) => c.key === "countryOfOrigin")).toBeUndefined();
  });
});

describe("evaluateCompliance — missing required elements", () => {
  it("fails when net contents is absent", () => {
    const report = evaluateCompliance(compliantSpirits({ netContents: absent() }));
    expect(report.compliant).toBe(false);
    const check = report.checks.find((c) => c.key === "netContents");
    expect(check?.status).toBe("fail");
  });

  it("fails when the government warning is missing entirely", () => {
    const report = evaluateCompliance(compliantSpirits({ governmentWarning: absent() }));
    const check = report.checks.find((c) => c.key === "governmentWarning");
    expect(check?.status).toBe("fail");
  });

  it("fails when the government warning wording is altered", () => {
    const altered = GOVERNMENT_WARNING_TEXT.replace("birth defects", "minor side effects");
    const report = evaluateCompliance(
      compliantSpirits({
        governmentWarning: field({ value: altered, verbatim: altered }),
      }),
    );
    const check = report.checks.find((c) => c.key === "governmentWarning");
    expect(check?.status).toBe("fail");
    expect(check?.reason).toMatch(/verbatim|wording/i);
  });
});

describe("evaluateCompliance — beverage-type rules", () => {
  it("does not require alcohol content for beer", () => {
    const beer: Extraction = {
      ...compliantSpirits(),
      beverageType: "beer",
      classType: field({ value: "India Pale Ale" }),
      alcoholContent: absent(),
    };
    const report = evaluateCompliance(beer);
    expect(report.checks.find((c) => c.key === "alcoholContent")).toBeUndefined();
    expect(report.compliant).toBe(true);
  });

  it("requires country of origin for imports", () => {
    const report = evaluateCompliance(compliantSpirits({ isImport: true, countryOfOrigin: absent() }));
    const check = report.checks.find((c) => c.key === "countryOfOrigin");
    expect(check?.status).toBe("fail");
    expect(report.compliant).toBe(false);
  });

  it("passes an import that declares country of origin", () => {
    const report = evaluateCompliance(
      compliantSpirits({ isImport: true, countryOfOrigin: field({ value: "Product of Scotland" }) }),
    );
    expect(report.compliant).toBe(true);
  });
});

describe("evaluateCompliance — imperfect images", () => {
  it("marks low-confidence present fields as uncertain, not pass", () => {
    const report = evaluateCompliance(
      compliantSpirits({ brandName: field({ value: "OLD TOM DISTILLERY", confidence: 0.4 }) }),
    );
    const check = report.checks.find((c) => c.key === "brandName");
    expect(check?.status).toBe("uncertain");
    expect(report.compliant).toBe(false);
    expect(report.hasUncertainty).toBe(true);
  });

  it("does not assert absence when the image is unreadable", () => {
    const report = evaluateCompliance(
      compliantSpirits({
        imageQuality: { readable: false, issues: ["glare", "blurry"], note: "heavy glare" },
        netContents: absent(),
      }),
    );
    const check = report.checks.find((c) => c.key === "netContents");
    expect(check?.status).toBe("uncertain");
    expect(report.summary).toMatch(/re-shoot/i);
  });
});

describe("evaluateCompliance — application match (COLA)", () => {
  it("flags a mismatch between label and application data", () => {
    const report = evaluateCompliance(compliantSpirits(), {
      brandName: "OLD TOM DISTILLERY",
      netContents: "1 L",
    });
    expect(report.matches).toBeDefined();
    const brand = report.matches?.find((m) => m.key === "brandName");
    const net = report.matches?.find((m) => m.key === "netContents");
    expect(brand?.status).toBe("match");
    expect(net?.status).toBe("mismatch");
  });

  it("omits matches when no expected data is supplied", () => {
    const report = evaluateCompliance(compliantSpirits(), {});
    expect(report.matches).toBeUndefined();
  });
});
