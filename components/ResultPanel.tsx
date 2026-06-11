import type { VerifyResponse } from "@/lib/api";
import { deriveVerdict, type CheckStatus, type RequirementCheck, type MatchCheck } from "@/lib/compliance";

/** Verdict badge text + colour, shared by the single view and the batch table. */
export const VERDICT_BADGE: Record<ReturnType<typeof deriveVerdict>, { text: string; tone: string }> = {
  compliant: { text: "Compliant", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  review: { text: "Needs review", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  noncompliant: { text: "Not compliant", tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  unreadable: { text: "Image not readable", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
};

const STATUS_STYLES: Record<CheckStatus, { dot: string; label: string; ring: string }> = {
  pass: { dot: "bg-emerald-500", label: "Pass", ring: "border-emerald-200 dark:border-emerald-900" },
  fail: { dot: "bg-red-500", label: "Fail", ring: "border-red-200 dark:border-red-900" },
  uncertain: { dot: "bg-amber-500", label: "Review", ring: "border-amber-200 dark:border-amber-900" },
};

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.7 ? "text-emerald-600" : value >= 0.4 ? "text-amber-600" : "text-red-600";
  return <span className={`text-xs font-medium tabular-nums ${tone}`}>{pct}% conf.</span>;
}

function CheckRow({ check }: { check: RequirementCheck }) {
  const s = STATUS_STYLES[check.status];
  return (
    <li className={`rounded-lg border p-3 ${s.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
          <span className="font-medium">{check.label}</span>
        </div>
        <div className="flex items-center gap-3">
          <ConfidenceBadge value={check.confidence} />
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{s.label}</span>
        </div>
      </div>
      {check.value && <p className="mt-1 pl-[18px] text-sm text-zinc-700 dark:text-zinc-300">{check.value}</p>}
      <p className="mt-1 pl-[18px] text-xs text-zinc-500">{check.reason}</p>
    </li>
  );
}

function MatchRow({ m }: { m: MatchCheck }) {
  const tone =
    m.status === "match" ? "bg-emerald-500" : m.status === "uncertain" ? "bg-amber-500" : "bg-red-500";
  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${tone}`} aria-hidden />
        <span className="font-medium">{m.label}</span>
      </div>
      <p className="mt-1 pl-[18px] text-xs text-zinc-500">{m.reason}</p>
      <div className="mt-1 grid grid-cols-2 gap-2 pl-[18px] text-xs">
        <span className="text-zinc-500">App: <span className="text-zinc-700 dark:text-zinc-300">{m.expected}</span></span>
        <span className="text-zinc-500">Label: <span className="text-zinc-700 dark:text-zinc-300">{m.found ?? "—"}</span></span>
      </div>
    </li>
  );
}

export function ResultPanel({ data }: { data: VerifyResponse }) {
  const { report, mock } = data;
  const verdict = VERDICT_BADGE[deriveVerdict(report)];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${verdict.tone}`}>{verdict.text}</span>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium capitalize text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {report.beverageType}
          {report.isImport ? " · import" : ""}
        </span>
        {mock && (
          <span
            className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            title="No ANTHROPIC_API_KEY set — showing a deterministic mock so the app is demoable without a key."
          >
            mock data
          </span>
        )}
      </div>

      <p className="text-sm text-zinc-700 dark:text-zinc-300">{report.summary}</p>

      {report.imageQuality.issues.length > 0 && (
        <p className="text-xs text-zinc-500">
          Image notes: {report.imageQuality.note} ({report.imageQuality.issues.join(", ")})
        </p>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          TTB required elements
        </h2>
        <ul className="grid gap-2">
          {report.checks.map((c) => (
            <CheckRow key={c.key} check={c} />
          ))}
        </ul>
      </div>

      {report.matches && report.matches.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Application match
          </h2>
          <ul className="grid gap-2">
            {report.matches.map((m) => (
              <MatchRow key={m.key} m={m} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
