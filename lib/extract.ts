import Anthropic from "@anthropic-ai/sdk";
import { extractionSchema, type Extraction } from "./schema";
import { GOVERNMENT_WARNING_TEXT } from "./ttb-rules";

/**
 * Vision extraction layer. Sends a label image to Claude's vision model and
 * gets back a validated, structured reading of the label's fields.
 *
 * Why a multimodal LLM instead of OCR + regex: real submitted labels are photos
 * — shot at angles, with glare, in poor light — and the required fields rarely
 * carry tidy "Brand:" prefixes a regex could anchor on. Claude Opus reads the
 * label the way a person would, returns clean structured fields, and (crucially
 * for this brief's bonus ask) reports its own confidence and the photo's quality
 * so we can degrade gracefully instead of hard-rejecting imperfect images.
 */

export const MODEL = "claude-opus-4-8";

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type SupportedMediaType = (typeof MEDIA_TYPES)[number];

export function isSupportedMediaType(t: string): t is SupportedMediaType {
  return (MEDIA_TYPES as readonly string[]).includes(t);
}

/** Hand-written JSON Schema for structured output (no unsupported constraints). */
const FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    present: { type: "boolean", description: "Whether this element appears on the label at all." },
    value: { type: ["string", "null"], description: "Cleaned, readable value. Null if absent." },
    verbatim: { type: ["string", "null"], description: "Exact text as printed on the label. Null if absent." },
    confidence: { type: "number", description: "Your confidence you read this correctly, 0 to 1." },
  },
  required: ["present", "value", "verbatim", "confidence"],
} as const;

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    beverageType: {
      type: "string",
      enum: ["beer", "wine", "spirits", "unknown"],
      description: "Best guess at the beverage class from the label.",
    },
    isImport: {
      type: "boolean",
      description: "True if the label indicates the product is imported (e.g. 'Product of', 'Imported by').",
    },
    imageQuality: {
      type: "object",
      additionalProperties: false,
      properties: {
        readable: { type: "boolean", description: "False if the photo is too poor to extract a meaningful reading." },
        issues: {
          type: "array",
          items: { type: "string" },
          description: "Photo problems, e.g. 'glare', 'steep angle', 'low light', 'blurry', 'partial crop'.",
        },
        note: { type: "string", description: "One-line plain-English note about the photo." },
      },
      required: ["readable", "issues", "note"],
    },
    brandName: FIELD_SCHEMA,
    classType: FIELD_SCHEMA,
    alcoholContent: FIELD_SCHEMA,
    netContents: FIELD_SCHEMA,
    bottlerNameAddress: FIELD_SCHEMA,
    countryOfOrigin: FIELD_SCHEMA,
    governmentWarning: FIELD_SCHEMA,
  },
  required: [
    "beverageType",
    "isImport",
    "imageQuality",
    "brandName",
    "classType",
    "alcoholContent",
    "netContents",
    "bottlerNameAddress",
    "countryOfOrigin",
    "governmentWarning",
  ],
} as const;

const SYSTEM_PROMPT = `You are a label-reading assistant for TTB (US Alcohol and Tobacco Tax and Trade Bureau) compliance review. You are given a photograph of an alcohol beverage label. Your ONLY job is to read what is on the label and report it as structured data. You do NOT decide compliance — downstream code does that.

Read the image carefully even if it is photographed at an angle, has glare, is dimly lit, slightly blurry, or partially cropped. Do your best to recover the text. Reserve a low \`readable\` flag and low field confidences for cases where the image is genuinely too poor to read.

For each field, report:
- present: whether it appears on the label
- value: a cleaned, readable version of the value
- verbatim: the exact text as printed (preserve wording, punctuation, capitalization)
- confidence: 0–1, how sure you are you read it correctly. Lower this honestly when glare, angle, blur, or crop obscured the text.

Fields to extract:
- brandName: the brand the product is sold under.
- classType: the class/type designation (e.g. "Kentucky Straight Bourbon Whiskey", "California Cabernet Sauvignon", "India Pale Ale").
- alcoholContent: alcohol content, e.g. "45% Alc./Vol. (90 Proof)".
- netContents: container volume, e.g. "750 mL".
- bottlerNameAddress: the name and address of the bottler, producer, or importer.
- countryOfOrigin: country of origin (only relevant for imports), e.g. "Product of Scotland".
- governmentWarning: the Surgeon General health warning. Capture its FULL text VERBATIM in \`verbatim\` — every word matters, since it must legally appear word-for-word. For reference the mandatory wording is: "${GOVERNMENT_WARNING_TEXT}". Report what the label actually shows, even if it differs.

Also report:
- beverageType: beer, wine, spirits, or unknown.
- isImport: whether the label indicates an imported product.
- imageQuality: readable (bool), issues (list), and a one-line note.

Set present=false, value=null, verbatim=null for any field you cannot find.`;

/** Strip a data: URL prefix if present and return raw base64. */
export function toBase64Data(input: string): string {
  const comma = input.indexOf(",");
  return input.startsWith("data:") && comma !== -1 ? input.slice(comma + 1) : input;
}

function clampConfidence(extraction: Extraction): Extraction {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const fields = [
    "brandName",
    "classType",
    "alcoholContent",
    "netContents",
    "bottlerNameAddress",
    "countryOfOrigin",
    "governmentWarning",
  ] as const;
  for (const f of fields) extraction[f].confidence = clamp(extraction[f].confidence);
  return extraction;
}

/** True when a real API key is configured. Drives the mock fallback. */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Extract structured label data from an image via Claude vision.
 * @param base64Data raw base64 (no data: prefix)
 * @param mediaType  one of the supported image MIME types
 */
export async function extractLabel(
  base64Data: string,
  mediaType: SupportedMediaType,
): Promise<Extraction> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: {
      format: {
        type: "json_schema",
        schema: EXTRACTION_JSON_SCHEMA,
      },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
          { type: "text", text: "Read this alcohol beverage label and report the structured fields." },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content to parse.");
  }

  const parsed = extractionSchema.parse(JSON.parse(textBlock.text));
  return clampConfidence(parsed);
}
