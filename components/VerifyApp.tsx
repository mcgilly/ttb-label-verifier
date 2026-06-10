"use client";

import { useCallback, useRef, useState } from "react";
import type { VerifyResponse } from "@/lib/api";
import { ResultPanel } from "./ResultPanel";

type ExpectedData = {
  brandName: string;
  classType: string;
  alcoholContent: string;
  netContents: string;
};

const EMPTY_EXPECTED: ExpectedData = {
  brandName: "",
  classType: "",
  alcoholContent: "",
  netContents: "",
};

export function VerifyApp() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [matchMode, setMatchMode] = useState(false);
  const [expected, setExpected] = useState<ExpectedData>(EMPTY_EXPECTED);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = useCallback((f: File | null) => {
    setResult(null);
    setError(null);
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) selectFile(f);
    },
    [selectFile],
  );

  async function verify() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("image", file);
      if (matchMode) {
        const supplied = Object.fromEntries(
          Object.entries(expected).filter(([, v]) => v.trim()),
        );
        if (Object.keys(supplied).length) body.append("expected", JSON.stringify(supplied));
      }
      const res = await fetch("/api/verify", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed.");
      setResult(data as VerifyResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
      {/* ---- Left: input ---- */}
      <section className="flex flex-col gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed p-4 text-center transition ${
            dragOver
              ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
              : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
          }`}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Label preview" className="max-h-full max-w-full rounded-md object-contain" />
          ) : (
            <div className="text-zinc-500">
              <p className="font-medium text-zinc-700 dark:text-zinc-300">Drop a label photo here</p>
              <p className="mt-1 text-sm">or click to browse — JPEG, PNG, WebP, GIF</p>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
          />
        </div>
        {file && (
          <p className="truncate text-sm text-zinc-500" title={file.name}>
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </p>
        )}

        {/* Optional COLA-style application match */}
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={matchMode}
              onChange={(e) => setMatchMode(e.target.checked)}
              className="h-4 w-4 accent-amber-600"
            />
            Also match against application data
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            Optional. Compare the label to what was submitted in the COLA application.
          </p>
          {matchMode && (
            <div className="mt-3 grid gap-2">
              {(
                [
                  ["brandName", "Brand name", "OLD TOM DISTILLERY"],
                  ["classType", "Class / type", "Kentucky Straight Bourbon Whiskey"],
                  ["alcoholContent", "Alcohol content", "45% Alc./Vol. (90 Proof)"],
                  ["netContents", "Net contents", "750 mL"],
                ] as const
              ).map(([key, label, placeholder]) => (
                <input
                  key={key}
                  value={expected[key]}
                  onChange={(e) => setExpected((s) => ({ ...s, [key]: e.target.value }))}
                  placeholder={`${label} — e.g. ${placeholder}`}
                  className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-amber-500 dark:border-zinc-700"
                />
              ))}
            </div>
          )}
        </div>

        <button
          onClick={verify}
          disabled={!file || loading}
          className="rounded-xl bg-amber-600 px-4 py-3 font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Analyzing label…" : "Verify label"}
        </button>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
      </section>

      {/* ---- Right: results ---- */}
      <section className="min-h-[200px]">
        {result ? (
          <ResultPanel data={result} />
        ) : (
          <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-zinc-200 text-zinc-400 dark:border-zinc-800">
            {loading ? "Reading the label…" : "Results will appear here."}
          </div>
        )}
      </section>
    </div>
  );
}
