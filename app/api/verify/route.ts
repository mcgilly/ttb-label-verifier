import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { evaluateCompliance } from "@/lib/compliance";
import { expectedDataSchema, type ExpectedData } from "@/lib/schema";
import {
  extractLabel,
  hasApiKey,
  isSupportedMediaType,
  toBase64Data,
  type SupportedMediaType,
} from "@/lib/extract";
import { mockExtraction } from "@/lib/mock";

export const runtime = "nodejs";
export const maxDuration = 60; // vision + thinking can take a few seconds

// Kept under Vercel's ~4.5 MB serverless request-body cap so oversized uploads
// get our clear 413 rather than an opaque platform rejection. Production would
// downscale client-side before upload to lift this constraint.
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * Label verification endpoint. This is the integration surface — a COLA-style
 * review workflow POSTs a label and gets back a structured compliance verdict to
 * attach to the application record. Two request shapes are accepted:
 *
 *  - multipart/form-data  — `image` file (+ optional `expected` JSON string).
 *    Used by the browser UI.
 *  - application/json     — `{ imageBase64, mediaType, filename?, expected? }`.
 *    Used for system-to-system calls (base64 or a data: URL).
 *
 * Both return the same JSON: `{ report, extraction, mock }`.
 */

interface ParsedInput {
  base64: string;
  mediaType: SupportedMediaType;
  /** Filename hint (drives mock scenarios when no API key is set). */
  hint: string;
  expected?: ExpectedData;
}

/** A parse error carrying the HTTP status to return. */
class InputError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function parseExpected(raw: unknown): ExpectedData | undefined {
  if (raw == null || raw === "") return undefined;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return expectedDataSchema.parse(obj);
  } catch {
    throw new InputError("Invalid 'expected' application data.", 400);
  }
}

function assertImage(byteLength: number, mediaType: string): asserts mediaType is SupportedMediaType {
  if (byteLength === 0) throw new InputError("Image is empty.", 400);
  if (byteLength > MAX_BYTES)
    throw new InputError(`Image too large (max ${MAX_BYTES / 1024 / 1024} MB).`, 413);
  if (!isSupportedMediaType(mediaType))
    throw new InputError(`Unsupported image type "${mediaType}". Use JPEG, PNG, WebP, or GIF.`, 415);
}

async function parseMultipart(req: NextRequest): Promise<ParsedInput> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new InputError("Could not read multipart/form-data body.", 400);
  }
  const file = form.get("image");
  if (!(file instanceof File)) throw new InputError("No image file provided.", 400);
  assertImage(file.size, file.type);
  return {
    base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    mediaType: file.type,
    hint: file.name,
    expected: parseExpected(form.get("expected")),
  };
}

async function parseJson(req: NextRequest): Promise<ParsedInput> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw new InputError("Invalid JSON body.", 400);
  }
  const rawImage = body.imageBase64 ?? body.image;
  const mediaType = body.mediaType;
  if (typeof rawImage !== "string" || !rawImage)
    throw new InputError("Missing 'imageBase64' (base64 or data: URL).", 400);
  if (typeof mediaType !== "string")
    throw new InputError("Missing 'mediaType' (e.g. image/png).", 400);

  const base64 = toBase64Data(rawImage);
  let bytes: number;
  try {
    bytes = Buffer.from(base64, "base64").length;
  } catch {
    throw new InputError("Could not decode 'imageBase64'.", 400);
  }
  assertImage(bytes, mediaType);
  return {
    base64,
    mediaType,
    hint: typeof body.filename === "string" ? body.filename : "",
    expected: parseExpected(body.expected),
  };
}

export async function POST(req: NextRequest) {
  let input: ParsedInput;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    input = contentType.includes("application/json")
      ? await parseJson(req)
      : await parseMultipart(req);
  } catch (err) {
    if (err instanceof InputError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Could not parse request." }, { status: 400 });
  }

  const usingMock = !hasApiKey();
  try {
    const extraction = usingMock
      ? mockExtraction(input.hint)
      : await extractLabel(input.base64, input.mediaType);
    const report = evaluateCompliance(extraction, input.expected);
    return NextResponse.json({ report, extraction, mock: usingMock });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: statusFor(err) });
  }
}

function statusFor(err: unknown): number {
  if (err instanceof Anthropic.APIError && typeof err.status === "number") return err.status;
  return 500;
}

function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return "Anthropic API key is invalid. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError)
    return "Rate limited by the Anthropic API. Please retry shortly.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error: ${err.message}`;
  if (err instanceof Error && err.name === "ZodError")
    return "The model returned an unexpected shape. Please retry.";
  return "Failed to analyze the label. Please try again.";
}
