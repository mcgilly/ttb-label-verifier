import { VerifyApp } from "@/components/VerifyApp";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">TTB Label Verifier</h1>
        <p className="mt-1 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Upload a photo of an alcohol beverage label. Claude vision reads it — even at an
          angle, with glare, or in poor light — and checks it against TTB labeling requirements,
          flagging anything missing, non-compliant, or too unclear to be sure.
        </p>
      </header>
      <VerifyApp />
      <footer className="mt-12 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800">
        Prototype. Checks a pragmatic subset of TTB requirements (27 CFR Parts 4, 5, 7, 16) and is
        not legal advice.
      </footer>
    </main>
  );
}
