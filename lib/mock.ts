import { GOVERNMENT_WARNING_TEXT } from "./ttb-rules";
import type { Extraction, ExtractedField } from "./schema";

/**
 * Deterministic mock extractions for when no ANTHROPIC_API_KEY is set.
 *
 * This lets the whole app — upload, compliance engine, UI — be exercised end to
 * end without a key or any token spend. The scenario is chosen from a hint in
 * the filename so a reviewer can demo each case on purpose. With a real key set,
 * this module is never used (see /api/verify).
 */

function f(value: string | null, confidence = 0.96): ExtractedField {
  return value === null
    ? { present: false, value: null, verbatim: null, confidence }
    : { present: true, value, verbatim: value, confidence };
}

const COMPLIANT_SPIRITS: Extraction = {
  beverageType: "spirits",
  isImport: false,
  imageQuality: { readable: true, issues: [], note: "Clear, well-lit, straight-on photo." },
  brandName: f("OLD TOM DISTILLERY"),
  classType: f("Kentucky Straight Bourbon Whiskey"),
  alcoholContent: f("45% Alc./Vol. (90 Proof)"),
  netContents: f("750 mL"),
  bottlerNameAddress: f("Distilled & Bottled by Old Tom Distillery, Bardstown, KY"),
  countryOfOrigin: f(null),
  governmentWarning: f(GOVERNMENT_WARNING_TEXT),
};

function clone(e: Extraction): Extraction {
  return JSON.parse(JSON.stringify(e));
}

type Scenario = { match: RegExp; build: () => Extraction };

const SCENARIOS: Scenario[] = [
  {
    // Missing the government warning entirely.
    match: /missing|nowarn|no-warning/i,
    build: () => {
      const e = clone(COMPLIANT_SPIRITS);
      e.governmentWarning = f(null);
      e.imageQuality.note = "Clear photo; no Government Warning detected.";
      return e;
    },
  },
  {
    // Government warning present but wording altered.
    match: /altered|wrong-warning|badwarning/i,
    build: () => {
      const e = clone(COMPLIANT_SPIRITS);
      const altered = GOVERNMENT_WARNING_TEXT.replace(
        "may cause health problems",
        "is totally fine in moderation",
      );
      e.governmentWarning = f(altered);
      return e;
    },
  },
  {
    // Imperfect image — glare/angle, low confidence, one field obscured.
    match: /glare|angle|blur|dark|dim|bad|imperfect/i,
    build: () => {
      const e = clone(COMPLIANT_SPIRITS);
      e.imageQuality = {
        readable: true,
        issues: ["glare", "slight angle"],
        note: "Glare across the lower third of the label; readable but some fields uncertain.",
      };
      e.netContents = { present: true, value: "750 mL", verbatim: "75? mL", confidence: 0.45 };
      e.alcoholContent = { present: true, value: "45% Alc./Vol.", verbatim: "45% Alc./Vol.", confidence: 0.6 };
      return e;
    },
  },
  {
    // Image too poor to read.
    match: /unreadable|garbage|blank|black/i,
    build: () => ({
      beverageType: "unknown",
      isImport: false,
      imageQuality: {
        readable: false,
        issues: ["severe blur", "low light"],
        note: "Image is too dark and blurry to read reliably.",
      },
      brandName: f(null, 0.2),
      classType: f(null, 0.2),
      alcoholContent: f(null, 0.2),
      netContents: f(null, 0.2),
      bottlerNameAddress: f(null, 0.2),
      countryOfOrigin: f(null, 0.2),
      governmentWarning: f(null, 0.2),
    }),
  },
  {
    // Imported wine, fully compliant.
    match: /import|wine|scotch|france/i,
    build: () => ({
      beverageType: "wine",
      isImport: true,
      imageQuality: { readable: true, issues: [], note: "Clear photo." },
      brandName: f("CHÂTEAU EXEMPLE"),
      classType: f("Bordeaux Red Wine"),
      alcoholContent: f("13.5% Alc./Vol."),
      netContents: f("750 mL"),
      bottlerNameAddress: f("Imported by Fine Wines Co., New York, NY"),
      countryOfOrigin: f("Product of France"),
      governmentWarning: f(GOVERNMENT_WARNING_TEXT),
    }),
  },
];

/** Pick a mock extraction from a filename hint; defaults to the compliant sample. */
export function mockExtraction(hint = ""): Extraction {
  const scenario = SCENARIOS.find((s) => s.match.test(hint));
  return scenario ? scenario.build() : clone(COMPLIANT_SPIRITS);
}
