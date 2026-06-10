import type { BeverageType } from "./schema";

/**
 * TTB labeling requirements, encoded as data so they're auditable and testable.
 *
 * Scope note: this is a pragmatic subset of the mandatory label elements common
 * to TTB-regulated beverages (27 CFR Parts 4, 5, 7, and 16). It is NOT the full
 * regulation — e.g. sulfite declarations, commodity/aging statements, FD&C
 * color disclosures, and state-specific rules are out of scope for this
 * prototype. See README "Assumptions & trade-offs".
 */

/** The label elements this tool checks. Keys line up with `Extraction` fields. */
export type RequirementKey =
  | "brandName"
  | "classType"
  | "alcoholContent"
  | "netContents"
  | "bottlerNameAddress"
  | "countryOfOrigin"
  | "governmentWarning";

export interface Requirement {
  key: RequirementKey;
  label: string;
  /** Why TTB requires it — surfaced in the UI for context. */
  description: string;
}

export const REQUIREMENT_META: Record<RequirementKey, Requirement> = {
  brandName: {
    key: "brandName",
    label: "Brand Name",
    description: "The brand under which the product is marketed.",
  },
  classType: {
    key: "classType",
    label: "Class / Type Designation",
    description: "The statement of the product's class or type (e.g. 'Kentucky Straight Bourbon Whiskey').",
  },
  alcoholContent: {
    key: "alcoholContent",
    label: "Alcohol Content",
    description: "Alcohol content as % Alc./Vol. (proof optional for spirits).",
  },
  netContents: {
    key: "netContents",
    label: "Net Contents",
    description: "The volume of the container (e.g. '750 mL').",
  },
  bottlerNameAddress: {
    key: "bottlerNameAddress",
    label: "Name & Address",
    description: "Name and address of the bottler, producer, or importer.",
  },
  countryOfOrigin: {
    key: "countryOfOrigin",
    label: "Country of Origin",
    description: "Required for imported products.",
  },
  governmentWarning: {
    key: "governmentWarning",
    label: "Government Warning",
    description: "The mandatory Surgeon General health warning, verbatim (27 CFR 16.21).",
  },
};

/**
 * Required elements per beverage type.
 *
 * Notable simplifications (documented in README):
 * - Alcohol content: required here for wine & spirits; treated as optional for
 *   malt beverages (beer), where TTB/state treatment varies.
 * - Country of origin is required only when the label indicates an import;
 *   handled separately via `isImport` rather than baked into these lists.
 */
const BASE_REQUIRED: Record<Exclude<BeverageType, "unknown">, RequirementKey[]> = {
  spirits: ["brandName", "classType", "alcoholContent", "netContents", "bottlerNameAddress", "governmentWarning"],
  wine: ["brandName", "classType", "alcoholContent", "netContents", "bottlerNameAddress", "governmentWarning"],
  beer: ["brandName", "classType", "netContents", "bottlerNameAddress", "governmentWarning"],
};

/**
 * The required-requirement keys for a given beverage type and import status.
 * For `unknown` beverage type we fall back to the spirits set (the strictest
 * common case) so we never under-check; the UI flags that the type is unknown.
 */
export function requiredKeysFor(beverageType: BeverageType, isImport: boolean): RequirementKey[] {
  const base =
    beverageType === "unknown" ? BASE_REQUIRED.spirits : BASE_REQUIRED[beverageType];
  const keys = [...base];
  if (isImport) keys.push("countryOfOrigin");
  return keys;
}

/**
 * The statutory Government Warning text (27 CFR 16.21). The label must carry
 * this verbatim. We compare a normalized form so capitalization/whitespace
 * differences don't cause false failures, but wording changes do.
 */
export const GOVERNMENT_WARNING_TEXT =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not " +
  "drink alcoholic beverages during pregnancy because of the risk of birth " +
  "defects. (2) Consumption of alcoholic beverages impairs your ability to " +
  "drive a car or operate machinery, and may cause health problems.";

/** Confidence below which a present field is treated as "uncertain", not a clean pass. */
export const CONFIDENCE_THRESHOLD = 0.7;

/** Normalized-similarity at/above which the government warning counts as matching. */
export const WARNING_MATCH_THRESHOLD = 0.97;
/** Below this, the warning is considered effectively absent rather than "altered". */
export const WARNING_PRESENT_THRESHOLD = 0.55;
