import type { Extraction, ExtractedField, ExpectedData } from "./schema";
import {
  CONFIDENCE_THRESHOLD,
  GOVERNMENT_WARNING_TEXT,
  REQUIREMENT_META,
  requiredKeysFor,
  WARNING_MATCH_THRESHOLD,
  WARNING_PRESENT_THRESHOLD,
  type RequirementKey,
} from "./ttb-rules";

export type CheckStatus = "pass" | "fail" | "uncertain";

export interface RequirementCheck {
  key: RequirementKey;
  label: string;
  description: string;
  status: CheckStatus;
  /** Cleaned value read from the label, if any. */
  value: string | null;
  confidence: number;
  /** Plain-English explanation of the verdict. */
  reason: string;
}

export interface MatchCheck {
  key: string;
  label: string;
  expected: string;
  found: string | null;
  status: "match" | "mismatch" | "uncertain";
  reason: string;
}

export interface ComplianceReport {
  beverageType: Extraction["beverageType"];
  isImport: boolean;
  imageQuality: Extraction["imageQuality"];
  /** True only when every required element is a clean pass. */
  compliant: boolean;
  /** True when one or more checks are uncertain (often due to image quality). */
  hasUncertainty: boolean;
  checks: RequirementCheck[];
  /** Optional COLA-style comparison against submitted application data. */
  matches?: MatchCheck[];
  summary: string;
}

export type Verdict = "compliant" | "review" | "noncompliant" | "unreadable";

/** Human-readable verdict labels, shared by the UI badges and the CSV export. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  compliant: "Compliant",
  review: "Needs review",
  noncompliant: "Not compliant",
  unreadable: "Image not readable",
};

/** Single source of truth for the headline verdict, shared by the single and batch views. */
export function deriveVerdict(report: ComplianceReport): Verdict {
  if (!report.imageQuality.readable) return "unreadable";
  if (report.compliant) return "compliant";
  if (report.hasUncertainty && report.checks.every((c) => c.status !== "fail")) return "review";
  return "noncompliant";
}

/** Lowercase, collapse whitespace, strip punctuation that doesn't change meaning. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s%./]/g, " ") // keep %, ., / which matter for ABV / volumes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-level Jaccard-ish similarity (0–1) using a Dice coefficient over word
 * sets. Robust for comparing the long government-warning paragraph: tolerant of
 * minor OCR-style noise but sensitive to dropped or changed clauses.
 */
export function textSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const wordsA = na.split(" ");
  const wordsB = nb.split(" ");
  const setB = new Map<string, number>();
  for (const w of wordsB) setB.set(w, (setB.get(w) ?? 0) + 1);

  let intersection = 0;
  for (const w of wordsA) {
    const count = setB.get(w);
    if (count && count > 0) {
      intersection++;
      setB.set(w, count - 1);
    }
  }
  return (2 * intersection) / (wordsA.length + wordsB.length);
}

function meetsConfidence(field: ExtractedField): boolean {
  return field.confidence >= CONFIDENCE_THRESHOLD;
}

/** Evaluate a normal (non-warning) required field. */
function checkStandardField(
  key: RequirementKey,
  field: ExtractedField,
  imageReadable: boolean,
): RequirementCheck {
  const meta = REQUIREMENT_META[key];
  const base = {
    key,
    label: meta.label,
    description: meta.description,
    value: field.value,
    confidence: field.confidence,
  };

  if (field.present && meetsConfidence(field)) {
    return { ...base, status: "pass", reason: `Found: "${field.value ?? ""}".` };
  }
  if (field.present && !meetsConfidence(field)) {
    return {
      ...base,
      status: "uncertain",
      reason: `Possibly present ("${field.value ?? ""}") but read with low confidence${
        imageReadable ? "" : " due to poor image quality"
      } — verify manually.`,
    };
  }
  // Not present. If the image was unreadable we can't assert absence confidently.
  if (!imageReadable) {
    return {
      ...base,
      status: "uncertain",
      reason: "Could not locate this element, but the image is too poor to be sure — re-shoot recommended.",
    };
  }
  return { ...base, status: "fail", reason: "Required element not found on the label." };
}

/** Evaluate the government warning via verbatim text comparison. */
function checkGovernmentWarning(
  field: ExtractedField,
  imageReadable: boolean,
): RequirementCheck {
  const meta = REQUIREMENT_META.governmentWarning;
  const found = field.verbatim ?? field.value ?? "";
  const similarity = field.present ? textSimilarity(found, GOVERNMENT_WARNING_TEXT) : 0;
  const base = {
    key: "governmentWarning" as const,
    label: meta.label,
    description: meta.description,
    value: field.value,
    confidence: field.confidence,
  };

  if (similarity >= WARNING_MATCH_THRESHOLD && meetsConfidence(field)) {
    return { ...base, status: "pass", reason: "Warning present and matches the mandatory wording." };
  }
  if (similarity >= WARNING_MATCH_THRESHOLD && !meetsConfidence(field)) {
    return {
      ...base,
      status: "uncertain",
      reason: "Wording appears correct but was read with low confidence — verify manually.",
    };
  }
  if (similarity >= WARNING_PRESENT_THRESHOLD) {
    return {
      ...base,
      status: "fail",
      reason: `A warning is present but its wording does not match the required statement (~${Math.round(
        similarity * 100,
      )}% match). The Government Warning must appear verbatim.`,
    };
  }
  if (!imageReadable) {
    return {
      ...base,
      status: "uncertain",
      reason: "No matching warning detected, but the image is too poor to be sure — re-shoot recommended.",
    };
  }
  return { ...base, status: "fail", reason: "Mandatory Government Warning statement not found." };
}

const FIELD_BY_KEY: Record<RequirementKey, (e: Extraction) => ExtractedField> = {
  brandName: (e) => e.brandName,
  classType: (e) => e.classType,
  alcoholContent: (e) => e.alcoholContent,
  netContents: (e) => e.netContents,
  bottlerNameAddress: (e) => e.bottlerNameAddress,
  countryOfOrigin: (e) => e.countryOfOrigin,
  governmentWarning: (e) => e.governmentWarning,
};

/** Compare extracted fields against expected application data (COLA-style match). */
function buildMatches(extraction: Extraction, expected: ExpectedData): MatchCheck[] {
  const fields: { key: keyof ExpectedData; label: string; field: ExtractedField }[] = [
    { key: "brandName", label: "Brand Name", field: extraction.brandName },
    { key: "classType", label: "Class / Type", field: extraction.classType },
    { key: "alcoholContent", label: "Alcohol Content", field: extraction.alcoholContent },
    { key: "netContents", label: "Net Contents", field: extraction.netContents },
  ];

  const matches: MatchCheck[] = [];
  for (const { key, label, field } of fields) {
    const exp = expected[key]?.trim();
    if (!exp) continue; // only compare fields the operator actually supplied
    const found = field.value;
    if (!field.present || !found) {
      matches.push({
        key,
        label,
        expected: exp,
        found: null,
        status: "mismatch",
        reason: "Expected value was not found on the label.",
      });
      continue;
    }
    const similarity = textSimilarity(found, exp);
    if (similarity >= 0.85 && meetsConfidence(field)) {
      matches.push({ key, label, expected: exp, found, status: "match", reason: "Label matches application." });
    } else if (similarity >= 0.85) {
      matches.push({
        key,
        label,
        expected: exp,
        found,
        status: "uncertain",
        reason: "Values match but the label was read with low confidence.",
      });
    } else {
      matches.push({
        key,
        label,
        expected: exp,
        found,
        status: "mismatch",
        reason: `Label shows "${found}", application expects "${exp}".`,
      });
    }
  }
  return matches;
}

/**
 * The heart of the tool: turn a raw model extraction into a TTB compliance
 * report. Pure function — no I/O — so it's fully unit-testable.
 */
export function evaluateCompliance(
  extraction: Extraction,
  expected?: ExpectedData,
): ComplianceReport {
  const imageReadable = extraction.imageQuality.readable;
  const requiredKeys = requiredKeysFor(extraction.beverageType, extraction.isImport);

  const checks: RequirementCheck[] = requiredKeys.map((key) => {
    const field = FIELD_BY_KEY[key](extraction);
    return key === "governmentWarning"
      ? checkGovernmentWarning(field, imageReadable)
      : checkStandardField(key, field, imageReadable);
  });

  const failures = checks.filter((c) => c.status === "fail");
  const uncertain = checks.filter((c) => c.status === "uncertain");
  const compliant = failures.length === 0 && uncertain.length === 0;
  const hasUncertainty = uncertain.length > 0;

  const matches =
    expected && Object.values(expected).some((v) => v && v.trim())
      ? buildMatches(extraction, expected)
      : undefined;

  return {
    beverageType: extraction.beverageType,
    isImport: extraction.isImport,
    imageQuality: extraction.imageQuality,
    compliant,
    hasUncertainty,
    checks,
    matches,
    summary: buildSummary(compliant, failures.length, uncertain.length, extraction),
  };
}

function buildSummary(
  compliant: boolean,
  failCount: number,
  uncertainCount: number,
  extraction: Extraction,
): string {
  if (!extraction.imageQuality.readable) {
    return "The image could not be read reliably. Please re-shoot the label with better lighting and framing.";
  }
  if (compliant) {
    return "All required TTB label elements are present and appear compliant.";
  }
  const parts: string[] = [];
  if (failCount > 0) parts.push(`${failCount} required element${failCount === 1 ? "" : "s"} failed`);
  if (uncertainCount > 0)
    parts.push(`${uncertainCount} element${uncertainCount === 1 ? "" : "s"} need manual review`);
  return `${parts.join(" and ")}.`;
}
