import { z } from "zod";

/**
 * The structured shape we ask Claude's vision model to return.
 *
 * The model only EXTRACTS what it sees on the label (plus a quality read of the
 * photo). It does NOT decide compliance — that judgment lives in pure,
 * testable code in `compliance.ts`. Keeping extraction and judgment separate
 * means the TTB rules are auditable and unit-tested, while the model does the
 * one thing it's uniquely good at: reading messy real-world images.
 */

/** A single label field as read by the model. */
export const extractedFieldSchema = z.object({
  /** Whether the field appears on the label at all. */
  present: z.boolean(),
  /** Cleaned, human-readable value (e.g. "45% Alc./Vol."). Null if absent. */
  value: z.string().nullable(),
  /** Exactly what the model read on the label, warts and all. Null if absent. */
  verbatim: z.string().nullable(),
  /** Model's confidence it read this field correctly, 0–1. */
  confidence: z.number().min(0).max(1),
});
export type ExtractedField = z.infer<typeof extractedFieldSchema>;

export const beverageTypeSchema = z.enum(["beer", "wine", "spirits", "unknown"]);
export type BeverageType = z.infer<typeof beverageTypeSchema>;

/** The full extraction returned by the model. */
export const extractionSchema = z.object({
  /** Best guess at the beverage class, which determines required fields. */
  beverageType: beverageTypeSchema,
  /** Whether the label indicates an imported product (triggers country-of-origin requirement). */
  isImport: z.boolean(),
  /** Photo-quality read — drives the "imperfect image" handling. */
  imageQuality: z.object({
    /** False when the photo is too poor to extract a meaningful reading. */
    readable: z.boolean(),
    /** e.g. ["glare", "steep angle", "low light", "blurry", "partial crop"]. */
    issues: z.array(z.string()),
    /** One-line plain-English note for the operator. */
    note: z.string(),
  }),
  brandName: extractedFieldSchema,
  classType: extractedFieldSchema,
  alcoholContent: extractedFieldSchema,
  netContents: extractedFieldSchema,
  bottlerNameAddress: extractedFieldSchema,
  countryOfOrigin: extractedFieldSchema,
  governmentWarning: extractedFieldSchema,
});
export type Extraction = z.infer<typeof extractionSchema>;

/** Optional application data an agent can verify the label against (COLA-style match). */
export const expectedDataSchema = z.object({
  brandName: z.string().optional(),
  classType: z.string().optional(),
  alcoholContent: z.string().optional(),
  netContents: z.string().optional(),
});
export type ExpectedData = z.infer<typeof expectedDataSchema>;
