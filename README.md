# TTB Label Verifier

AI-assisted compliance checking for US alcohol beverage labels. Upload a photo of
a label and the app reads it with **Claude vision**, then checks it against TTB
labeling requirements — flagging anything **missing**, **non-compliant**, or **too
unclear to be sure**.

It is built to handle the part of the brief that matters most: **labels that
aren't perfectly shot** — photographed at an angle, with glare, or in poor light.
Instead of rejecting those outright, the tool reads what it can and reports its
confidence, so an imperfect photo degrades gracefully into "please verify" rather
than a false pass/fail.

> **Live demo:** https://ttb-label-verifier-six.vercel.app

---

## What it checks

For the label's beverage type (beer / wine / spirits), it verifies the common
mandatory TTB elements:

- **Brand name**
- **Class / type designation**
- **Alcohol content** (required for wine & spirits)
- **Net contents**
- **Name & address** of bottler / producer / importer
- **Country of origin** (when the label indicates an import)
- **Government Warning** — compared **verbatim** against the statutory wording
  (27 CFR 16.21); altered wording fails, not just a missing statement

Each element comes back as **Pass / Fail / Review**, with a plain-English reason
and the model's read **confidence**.

There's also an optional **application-match mode** (the COLA workflow): paste the
brand / class / ABV / net contents from the application and the tool compares them
against what's actually on the label.

---

## Approach & key decisions

**Vision LLM instead of OCR + regex.** The original prototype used Tesseract OCR
plus regular expressions. That struggles with exactly the inputs this domain
produces: angled phone photos, glare, and labels where "OLD TOM DISTILLERY" is
just large display type with no `Brand:` prefix to anchor a regex on. A multimodal
model (Claude `claude-opus-4-8`) reads the label the way a person does, returns
clean structured fields, and reports its own confidence — which is what makes the
"imperfect image" handling possible.

**Extraction and judgment are separate.** The model only **extracts** what it sees
(plus a quality read of the photo). The **compliance judgment** lives in pure,
unit-tested TypeScript ([`lib/compliance.ts`](lib/compliance.ts) +
[`lib/ttb-rules.ts`](lib/ttb-rules.ts)). The TTB rules are therefore auditable and
testable in isolation, and the model is never asked to "decide compliance" — only
to read. This is the central design choice.

**Structured output, validated.** The model is constrained to a JSON schema via
the Messages API's structured-output format, and the response is re-validated with
Zod ([`lib/schema.ts`](lib/schema.ts)) before it reaches the rules engine. No
fragile parsing.

**Graceful degradation on bad photos (the bonus ask).** Three mechanisms:
1. The model reads angled / glare / low-light photos natively.
2. Per-field **confidence** below a threshold turns a "present" field into
   **Review**, not a clean pass.
3. When the image is genuinely unreadable, the tool says so and asks for a
   re-shoot — and crucially does **not** assert that a field is absent when it
   simply couldn't see it.

**Mock mode so it always runs.** With no `ANTHROPIC_API_KEY`, the app serves
deterministic sample results so the full UI and rules engine are demoable without
a key or token spend ([`lib/mock.ts`](lib/mock.ts)). With a key, it calls the real
model. The sample-label filenames double as mock-scenario triggers, so the demo is
coherent either way.

## Tools used

- **Next.js 16** (App Router) + **TypeScript** — one repo, server-side API route
  keeps the API key off the client, one-click Vercel deploy.
- **Claude `claude-opus-4-8`** via **`@anthropic-ai/sdk`** — vision + structured
  output.
- **Zod** — schema validation at the model and API boundaries.
- **Tailwind CSS** — UI.
- **Vitest** — unit tests for the compliance engine.
- **sharp** — generates the sample labels (including the degraded photo).

## Project structure

```
app/
  page.tsx                 landing + the verifier UI
  api/verify/route.ts      POST image -> extract -> evaluate -> JSON report
lib/
  schema.ts                Zod schemas + types (model extraction, API I/O)
  ttb-rules.ts             TTB requirements & gov-warning text, encoded as data
  compliance.ts            pure compliance engine (judges an extraction)
  extract.ts               Claude vision call + structured output
  mock.ts                  keyless deterministic fallback
  api.ts                   shared response types
  batch.ts                 concurrency pool + CSV export (pure, tested)
  eval.ts                  accuracy scoring + aggregation (pure, tested)
components/
  VerifyApp.tsx            upload, drag/drop, match-mode form
  ResultPanel.tsx          per-requirement result cards + confidence badges
components/
  BatchPanel.tsx           multi-file batch view + results table + CSV export
eval/
  fixtures.ts              ground-truth labels for the accuracy eval
  accuracy.eval.ts         real-model eval runner with accuracy thresholds
test/
  compliance.test.ts       unit tests for the rules engine
  batch.test.ts            unit tests for the concurrency pool + CSV
  eval.test.ts             unit tests for the eval scorer
scripts/
  make-samples.mjs         generates sample-labels/
sample-labels/             ready-to-test images (compliant, missing/altered
                           warning, glare+angle, imported wine)
```

---

## Run locally

```bash
npm install
cp .env.example .env.local      # optional — add a real key for live extraction
npm run dev                     # http://localhost:3000
```

- **Without a key:** runs in mock mode. Upload any image from `sample-labels/` —
  the filename selects the scenario (e.g. `*missing-warning*`, `*glare*`).
- **With a key:** add `ANTHROPIC_API_KEY` to `.env.local` for real Claude vision
  extraction. Try the `glare-angle` sample to see it recover a poorly-shot photo.

Other commands:

```bash
npm test                        # run the compliance unit tests (offline)
npm run eval                    # run the accuracy eval against real Claude vision (needs key)
npm run build                   # production build
node scripts/make-samples.mjs   # regenerate sample labels
```

---

## Evaluation (accuracy)

Calling a vision model is easy; knowing whether it's *right* is the hard part.
There's an eval harness ([`eval/`](eval/), [`lib/eval.ts`](lib/eval.ts)) that runs
the **real model** over a ground-truth fixture set and scores it against expected
extraction + compliance verdicts — so accuracy is measured, not assumed, and prompt
or model changes can be regression-tested.

```bash
npm run eval
```

The scoring logic is pure and unit-tested ([`test/eval.test.ts`](test/eval.test.ts));
field values match by normalized similarity, so casing/punctuation differences don't
count as errors. The suite also asserts accuracy thresholds, so it doubles as a
regression gate (e.g. it fails if any altered/missing Government Warning slips through).

**Current results** (5-case fixture set, against `claude-opus-4-8`):

| Metric | Result |
|---|---|
| Compliance-verdict accuracy | 100% (5/5) |
| Beverage-type accuracy | 100% |
| Required-field presence accuracy | 100% |
| Field-value accuracy | 100% |
| Government-warning detection (missing/altered) | 100% |

Notably, the **glare + angle + low-light** photo scored a correct, fully-compliant
verdict — the bonus case, verified end to end.

> **Honest caveat:** the fixture labels are programmatically generated (clean
> renders + one synthetically degraded photo), not a broad sample of real-world
> photographs. 100% here means "the pipeline is correct on representative cases,"
> not "the model never errs." The value is the *harness*: drop in real labeled
> photos and the same `npm run eval` quantifies real-world accuracy and guards
> against regressions.

---

## Deploy (Vercel)

1. Push this repo to GitHub.
2. Import it in Vercel (framework auto-detected as Next.js).
3. Set the **`ANTHROPIC_API_KEY`** environment variable.
4. Deploy. The `/api/verify` route runs as a serverless function.

---

## Assumptions & trade-offs

- **Scope of TTB rules.** This checks a **pragmatic subset** of the mandatory
  elements common across 27 CFR Parts 4, 5, 7, and 16. It deliberately omits
  rules like sulfite/allergen declarations, commodity/aging statements, FD&C color
  disclosures, container-size standards of fill, and state-specific requirements.
  Alcohol content is treated as required for wine & spirits and optional for malt
  beverages (where TTB/state treatment varies). Unknown beverage type falls back
  to the strictest (spirits) requirement set so nothing is under-checked.
- **Single LLM call, not an agent.** One structured vision call is sufficient and
  is cheaper, faster, and more predictable than an agentic loop. Deliberately not
  over-engineered.
- **The model can still misread.** Confidence scores and the verbatim warning
  comparison mitigate this, but this is a **review aid, not legal advice** and not
  a substitute for a TTB specialist's sign-off.
- **No persistence.** Images are processed in-memory per request and not stored.

## If this were going to production

- Cache the system prompt (prompt caching) to cut cost/latency on volume.
- Batch mode for bulk submissions (the Messages Batches API).
- Persist results + an audit trail; add authentication.
- Expand the rule set toward full CFR coverage with a regulatory reviewer.
- Add visual region highlighting (where on the label each field was found).
