"use client";

import { useState } from "react";
import { SingleVerify } from "./SingleVerify";
import { BatchPanel } from "./BatchPanel";

type Mode = "single" | "batch";

export function VerifyApp() {
  const [mode, setMode] = useState<Mode>("single");

  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex w-fit rounded-xl border border-zinc-200 p-1 dark:border-zinc-800">
        <TabButton active={mode === "single"} onClick={() => setMode("single")}>
          Single label
        </TabButton>
        <TabButton active={mode === "batch"} onClick={() => setMode("batch")}>
          Batch
        </TabButton>
      </div>
      {mode === "single" ? <SingleVerify /> : <BatchPanel />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-amber-600 text-white"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
