"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { deriveVerdict } from "@/lib/compliance";
import {
  batchToCsv,
  DEFAULT_CONCURRENCY,
  MAX_BATCH,
  runPool,
  verifyOne,
  type BatchItem,
} from "@/lib/batch";
import { ResultPanel, VERDICT_BADGE } from "./ResultPanel";

let idCounter = 0;
const nextId = () => `f${idCounter++}`;

type Action =
  | { type: "add"; files: File[] }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "status"; id: string; status: BatchItem["status"] }
  | { type: "done"; id: string; result: BatchItem["result"] }
  | { type: "error"; id: string; error: string };

function reducer(items: BatchItem[], action: Action): BatchItem[] {
  switch (action.type) {
    case "add": {
      const room = MAX_BATCH - items.length;
      const added = action.files.slice(0, Math.max(0, room)).map((file) => ({
        id: nextId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "queued" as const,
      }));
      return [...items, ...added];
    }
    case "remove": {
      const target = items.find((i) => i.id === action.id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return items.filter((i) => i.id !== action.id);
    }
    case "clear":
      items.forEach((i) => URL.revokeObjectURL(i.previewUrl));
      return [];
    case "status":
      return items.map((i) => (i.id === action.id ? { ...i, status: action.status } : i));
    case "done":
      return items.map((i) =>
        i.id === action.id ? { ...i, status: "done", result: action.result } : i,
      );
    case "error":
      return items.map((i) =>
        i.id === action.id ? { ...i, status: "error", error: action.error } : i,
      );
    default:
      return items;
  }
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function BatchPanel() {
  const [items, dispatch] = useReducer(reducer, []);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke any outstanding object URLs on unmount.
  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.previewUrl)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list).filter((f) => IMAGE_TYPES.includes(f.type));
    if (files.length) dispatch({ type: "add", files });
  }, []);

  async function run() {
    setRunning(true);
    setExpanded(null);
    const queue = items.filter((i) => i.status === "queued" || i.status === "error");
    await runPool(queue, DEFAULT_CONCURRENCY, async (item) => {
      dispatch({ type: "status", id: item.id, status: "analyzing" });
      try {
        const result = await verifyOne(item.file);
        dispatch({ type: "done", id: item.id, result });
      } catch (e) {
        dispatch({ type: "error", id: item.id, error: e instanceof Error ? e.message : "Failed." });
      }
    });
    setRunning(false);
  }

  function downloadCsv() {
    const blob = new Blob([batchToCsv(items)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ttb-batch-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const done = items.filter((i) => i.status === "done" && i.result);
  const counts = done.reduce(
    (acc, i) => {
      const v = deriveVerdict(i.result!.report);
      acc[v]++;
      return acc;
    },
    { compliant: 0, review: 0, noncompliant: 0, unreadable: 0 },
  );
  const errored = items.filter((i) => i.status === "error").length;
  const atCapacity = items.length >= MAX_BATCH;

  return (
    <div className="flex flex-col gap-5">
      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
          dragOver
            ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
        }`}
      >
        <p className="font-medium text-zinc-700 dark:text-zinc-300">
          Drop multiple label photos here
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          or click to browse — up to {MAX_BATCH} images (JPEG, PNG, WebP, GIF)
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {atCapacity && (
        <p className="text-xs text-amber-600">
          Reached the {MAX_BATCH}-file limit for this demo. For larger volumes the Anthropic
          Batches API (async) would be the production path.
        </p>
      )}

      {items.length > 0 && (
        <>
          {/* Controls + summary */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={run}
              disabled={running || items.every((i) => i.status === "done")}
              className="rounded-xl bg-amber-600 px-4 py-2.5 font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Analyzing…" : `Verify ${items.length} label${items.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={downloadCsv}
              disabled={running || done.length === 0}
              className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Download CSV
            </button>
            <button
              onClick={() => dispatch({ type: "clear" })}
              disabled={running}
              className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Clear
            </button>
            {done.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Pill tone="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" n={counts.compliant} label="compliant" />
                <Pill tone="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" n={counts.noncompliant} label="non-compliant" />
                <Pill tone="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" n={counts.review + counts.unreadable} label="need review" />
                {errored > 0 && <Pill tone="bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" n={errored} label="errored" />}
              </div>
            )}
          </div>

          {/* Results table */}
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Label</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Verdict</th>
                  <th className="px-3 py-2 font-medium">Issues</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <BatchRow
                    key={item.id}
                    item={item}
                    expanded={expanded === item.id}
                    onToggle={() => setExpanded((e) => (e === item.id ? null : item.id))}
                    onRemove={() => dispatch({ type: "remove", id: item.id })}
                    canRemove={!running}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Pill({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {n} {label}
    </span>
  );
}

function BatchRow({
  item,
  expanded,
  onToggle,
  onRemove,
  canRemove,
}: {
  item: BatchItem;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const report = item.result?.report;
  const verdict = report ? VERDICT_BADGE[deriveVerdict(report)] : null;
  const issues = report ? report.checks.filter((c) => c.status !== "pass").length : 0;

  return (
    <>
      <tr className="border-t border-zinc-100 dark:border-zinc-800/70">
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.previewUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
            <span className="max-w-[180px] truncate" title={item.file.name}>
              {item.file.name}
            </span>
          </div>
        </td>
        <td className="px-3 py-2 capitalize text-zinc-600 dark:text-zinc-400">
          {report ? report.beverageType : "—"}
        </td>
        <td className="px-3 py-2">
          {item.status === "queued" && <span className="text-zinc-400">Queued</span>}
          {item.status === "analyzing" && <span className="text-amber-600">Analyzing…</span>}
          {item.status === "error" && <span className="text-red-600">Error</span>}
          {verdict && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${verdict.tone}`}>
              {verdict.text}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
          {report ? (issues === 0 ? "—" : issues) : ""}
        </td>
        <td className="px-3 py-2 text-right">
          {report ? (
            <button onClick={onToggle} className="text-xs font-medium text-amber-700 hover:underline dark:text-amber-400">
              {expanded ? "Hide" : "Details"}
            </button>
          ) : canRemove && item.status !== "analyzing" ? (
            <button onClick={onRemove} className="text-xs text-zinc-400 hover:text-red-600">
              Remove
            </button>
          ) : null}
        </td>
      </tr>
      {expanded && item.result && (
        <tr className="border-t border-zinc-100 dark:border-zinc-800/70">
          <td colSpan={5} className="bg-zinc-50/60 px-4 py-4 dark:bg-zinc-900/40">
            <ResultPanel data={item.result} />
          </td>
        </tr>
      )}
      {item.status === "error" && (
        <tr>
          <td colSpan={5} className="px-3 pb-2 text-xs text-red-600">
            {item.error}
          </td>
        </tr>
      )}
    </>
  );
}
