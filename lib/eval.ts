import type { BeverageType, Extraction } from "./schema";
import type { RequirementKey } from "./ttb-rules";
import {
  deriveVerdict,
  evaluateCompliance,
  textSimilarity,
  type CheckStatus,
  type Verdict,
} from "./compliance";

/**
 * Evaluation harness — the part that proves the system is actually *correct*,
 * not just that it runs. Anyone can call a vision model; a production AI system
 * needs a way to measure accuracy against ground truth and catch regressions
 * when the prompt or model changes.
 *
 * The scoring here is pure (no I/O), so it's unit-tested with synthetic
 * extractions. The runner in eval/ feeds it real model output.
 */

/** Ground-truth expectation for one label image. */
export interface Fixture {
  file: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  /** Short human description of what this case is testing. */
  note: string;
  expect: {
    beverageType: BeverageType;
    isImport: boolean;
    verdict: Verdict;
    /** Expected per-field presence and (optionally) value. */
    fields: Partial<Record<RequirementKey, { present: boolean; value?: string }>>;
    /** Expected status of the government-warning compliance check. */
    warningStatus?: CheckStatus;
  };
}

/** Similarity at/above which an extracted field value counts as matching ground truth. */
export const VALUE_MATCH_THRESHOLD = 0.6;

export interface CaseScore {
  file: string;
  note: string;
  beverageOk: boolean;
  verdictOk: boolean;
  expectedVerdict: Verdict;
  actualVerdict: Verdict;
  /** Field-presence correctness. */
  presence: { correct: number; total: number };
  /** Field-value correctness (only fields with an expected value). */
  values: { correct: number; total: number };
  /** Whether the government-warning check matched expectation (null if not asserted). */
  warningOk: boolean | null;
  /** Human-readable list of what went wrong. */
  mismatches: string[];
}

const ALL_KEYS: RequirementKey[] = [
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "bottlerNameAddress",
  "countryOfOrigin",
  "governmentWarning",
];

function fieldOf(extraction: Extraction, key: RequirementKey) {
  return extraction[key];
}

/** Score one real (or synthetic) extraction against its ground-truth fixture. */
export function scoreCase(extraction: Extraction, fixture: Fixture): CaseScore {
  const report = evaluateCompliance(extraction);
  const actualVerdict = deriveVerdict(report);
  const mismatches: string[] = [];

  const beverageOk = extraction.beverageType === fixture.expect.beverageType;
  if (!beverageOk)
    mismatches.push(`beverageType: expected ${fixture.expect.beverageType}, got ${extraction.beverageType}`);

  const verdictOk = actualVerdict === fixture.expect.verdict;
  if (!verdictOk)
    mismatches.push(`verdict: expected ${fixture.expect.verdict}, got ${actualVerdict}`);

  // Field presence + value accuracy.
  let presenceCorrect = 0;
  let presenceTotal = 0;
  let valueCorrect = 0;
  let valueTotal = 0;

  for (const key of ALL_KEYS) {
    const expected = fixture.expect.fields[key];
    if (!expected) continue; // only score fields the fixture asserts
    presenceTotal++;
    const field = fieldOf(extraction, key);
    if (field.present === expected.present) {
      presenceCorrect++;
    } else {
      mismatches.push(`${key}.present: expected ${expected.present}, got ${field.present}`);
    }
    if (expected.present && expected.value) {
      valueTotal++;
      const sim = field.value ? textSimilarity(field.value, expected.value) : 0;
      if (sim >= VALUE_MATCH_THRESHOLD) {
        valueCorrect++;
      } else {
        mismatches.push(
          `${key}.value: expected ~"${expected.value}", got "${field.value ?? ""}" (sim ${sim.toFixed(2)})`,
        );
      }
    }
  }

  // Government-warning check status.
  let warningOk: boolean | null = null;
  if (fixture.expect.warningStatus) {
    const check = report.checks.find((c) => c.key === "governmentWarning");
    warningOk = check?.status === fixture.expect.warningStatus;
    if (!warningOk)
      mismatches.push(
        `governmentWarning check: expected ${fixture.expect.warningStatus}, got ${check?.status ?? "n/a"}`,
      );
  }

  return {
    file: fixture.file,
    note: fixture.note,
    beverageOk,
    verdictOk,
    expectedVerdict: fixture.expect.verdict,
    actualVerdict,
    presence: { correct: presenceCorrect, total: presenceTotal },
    values: { correct: valueCorrect, total: valueTotal },
    warningOk,
    mismatches,
  };
}

export interface EvalSummary {
  cases: number;
  verdictAccuracy: number;
  beverageAccuracy: number;
  fieldPresenceAccuracy: number;
  fieldValueAccuracy: number;
  /** Of cases asserting a warning status, fraction the check got right. */
  warningCheckAccuracy: number;
}

/** Aggregate per-case scores into headline metrics. */
export function aggregate(scores: CaseScore[]): EvalSummary {
  const n = scores.length || 1;
  const sum = (f: (s: CaseScore) => number) => scores.reduce((a, s) => a + f(s), 0);

  const presence = scores.reduce(
    (a, s) => ({ correct: a.correct + s.presence.correct, total: a.total + s.presence.total }),
    { correct: 0, total: 0 },
  );
  const values = scores.reduce(
    (a, s) => ({ correct: a.correct + s.values.correct, total: a.total + s.values.total }),
    { correct: 0, total: 0 },
  );
  const warningCases = scores.filter((s) => s.warningOk !== null);

  return {
    cases: scores.length,
    verdictAccuracy: sum((s) => (s.verdictOk ? 1 : 0)) / n,
    beverageAccuracy: sum((s) => (s.beverageOk ? 1 : 0)) / n,
    fieldPresenceAccuracy: presence.total ? presence.correct / presence.total : 1,
    fieldValueAccuracy: values.total ? values.correct / values.total : 1,
    warningCheckAccuracy:
      warningCases.length ? warningCases.filter((s) => s.warningOk).length / warningCases.length : 1,
  };
}

/** Render a metrics summary + per-case table as plain text for the console / README. */
export function formatReport(scores: CaseScore[], summary: EvalSummary): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const lines: string[] = [];
  lines.push("");
  lines.push("TTB Label Verifier — accuracy eval");
  lines.push("===================================");
  lines.push(`cases:                  ${summary.cases}`);
  lines.push(`verdict accuracy:       ${pct(summary.verdictAccuracy)}`);
  lines.push(`beverage-type accuracy: ${pct(summary.beverageAccuracy)}`);
  lines.push(`field presence accuracy:${pct(summary.fieldPresenceAccuracy)}`);
  lines.push(`field value accuracy:   ${pct(summary.fieldValueAccuracy)}`);
  lines.push(`gov-warning check acc.: ${pct(summary.warningCheckAccuracy)}`);
  lines.push("");
  for (const s of scores) {
    const ok = s.mismatches.length === 0 ? "PASS" : "FAIL";
    lines.push(`[${ok}] ${s.file} — ${s.note}`);
    lines.push(`       verdict ${s.actualVerdict} (want ${s.expectedVerdict}); presence ${s.presence.correct}/${s.presence.total}; values ${s.values.correct}/${s.values.total}`);
    for (const m of s.mismatches) lines.push(`        - ${m}`);
  }
  lines.push("");
  return lines.join("\n");
}
