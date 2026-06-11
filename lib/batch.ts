import type { VerifyResponse } from "./api";

/**
 * Batch processing runs entirely client-side: the browser fires one request per
 * file at the existing /api/verify endpoint through a small concurrency pool.
 *
 * Why not a server-side loop: each label is one vision call (5–30s) and a single
 * Vercel function is capped at 60s, so looping N labels server-side would time
 * out and give no progress. Per-file client requests respect that limit, isolate
 * failures, and let us stream live per-row progress. For true bulk ingestion the
 * Anthropic Batches API (async, 50% cheaper) would be the move — noted in README.
 */

/** Max files accepted in one batch — keeps cost/rate-limits sane for a demo. */
export const MAX_BATCH = 25;
/** How many labels to analyze at once. */
export const DEFAULT_CONCURRENCY = 4;

export type ItemStatus = "queued" | "analyzing" | "done" | "error";

export interface BatchItem {
  id: string;
  file: File;
  previewUrl: string;
  status: ItemStatus;
  result?: VerifyResponse;
  error?: string;
}

/** POST a single image to /api/verify; throws with a useful message on failure. */
export async function verifyOne(file: File, signal?: AbortSignal): Promise<VerifyResponse> {
  const body = new FormData();
  body.append("image", file);
  const res = await fetch("/api/verify", { method: "POST", body, signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status}).`);
  return data as VerifyResponse;
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once.
 * Resolves when all items have been processed; individual rejections are the
 * worker's responsibility to catch (so one failure never aborts the pool).
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}
