import type { ComplianceReport } from "./compliance";
import type { Extraction } from "./schema";

/** Successful response shape from POST /api/verify. */
export interface VerifyResponse {
  report: ComplianceReport;
  extraction: Extraction;
  /** True when the result came from the keyless mock path. */
  mock: boolean;
}

export interface VerifyError {
  error: string;
}
