import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { evaluateCompliance } from "@/lib/compliance";
import { expectedDataSchema } from "@/lib/schema";
import { extractLabel, hasApiKey, isSupportedMediaType } from "@/lib/extract";
import { mockExtraction } from "@/lib/mock";

export const runtime = "nodejs";
export const maxDuration = 60; // vision + thinking can take a few seconds

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image file provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Image too large (max ${MAX_BYTES / 1024 / 1024} MB).` },
      { status: 413 },
    );
  }
  if (!isSupportedMediaType(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type "${file.type}". Use JPEG, PNG, WebP, or GIF.` },
      { status: 415 },
    );
  }

  // Optional COLA-style application data to verify the label against.
  const expectedRaw = form.get("expected");
  let expected;
  if (typeof expectedRaw === "string" && expectedRaw.trim()) {
    try {
      expected = expectedDataSchema.parse(JSON.parse(expectedRaw));
    } catch {
      return NextResponse.json({ error: "Invalid 'expected' application data." }, { status: 400 });
    }
  }

  const usingMock = !hasApiKey();

  try {
    const extraction = usingMock
      ? mockExtraction(file.name)
      : await extractLabel(
          Buffer.from(await file.arrayBuffer()).toString("base64"),
          file.type,
        );

    const report = evaluateCompliance(extraction, expected);
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
