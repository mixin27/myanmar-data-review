# Myanmar Data Review

A private, local-first workflow for carefully reviewing Myanmar text in CSV files.
Open a CSV, confirm its layout, choose text columns, then inspect encoding and
Burmese structure. Review proposed Unicode changes and approve them deliberately.
Original values and source bytes remain preserved.

The interface now follows a three-step import flow. Engineering test screens,
raw diagnostics and build identities are excluded from the product build.
“File ready for review” means import is complete; it does not mean that language
inspection or conversion has run. Choose Inspect selected text to see findings.
Reviewed exports and explicit save/resume are the next milestone in
[PRODUCT_PLAN.md](PRODUCT_PLAN.md).

## Run

Use Node **24.21.0** (`nvm use`) and pnpm **12.4.2**:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. No environment files, credentials, MyanLex
checkout, authentication or processing API are needed. Text stays in memory and
is not saved automatically. Download original returns the exact source bytes;
it is not a reviewed-data export.

## Current scope

- Strict, incremental UTF-8 CSV import in a dedicated browser worker; optional BOM.
- Explicit comma, semicolon or tab delimiter and header confirmation.
- Lossless string values, immutable records, positional IDs and source fingerprint.
- Clear errors for invalid UTF-8, malformed quoting, ragged records and limits.
- Explicit column selection, five-row layout preview and 25-row paged data table.
- Cancellation, timeout, failure recovery and suppression of stale results.
- File replacement confirmation and unsaved-work navigation warning.
- Local inspection of all selected cells, with encoding and structural evidence.
- Opt-in Unicode conversion and NFC, original/proposal comparison, review queues.
- Separate manual proposals and approval, revision-bound cell/bulk decisions.
- Partial failure status, preserved completed findings, explicit retry and cancellation.

Limits are 10 MiB/file, 50,000 data rows, 100 columns, 500,000 fields including
headers and 100,000 UTF-16 code units/value. The 30-second deadline is a safety
limit. These guards were exercised with synthetic profiles; they are not capacity
or latency guarantees across devices. No partial import is exposed on failure.

Review accepts up to 10,000 selected cells, with a cumulative 16,000,000-code-unit
serialized-result guard. Select fewer columns or split files if needed. A result
budget or worker failure stops processing explicitly, retaining completed findings
and marking remaining cells uninspected. The 30-second processing timeout applies
to each cell, not the whole dataset. Reviews and approvals remain in memory only.

Inspect first. Then enable Propose Unicode conversion or Normalize Unicode (NFC)
if desired and run inspection again. Starting a new review clears previous findings,
proposals and approvals after confirmation. Use the review queues and individual
cell view to approve changes, keep originals, or propose manual replacements.
Unresolved findings remain visible after manual decisions. Download original always
returns the unmodified input, including after approval.

## Verify

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
pnpm format:check
pnpm verify:clean
```

`pnpm check` generates typed engine identity, lints, typechecks both browser/worker
scopes, runs unit/property/integration tests, builds production assets, verifies
worker boundaries and notices, and installs the pinned archives in an offline
consumer with an empty store. Node filesystem permissions restrict that consumer
to its temporary directory and exclude the sibling source repository.

`pnpm test:browser` builds a separate `.test-build` containing the real product and
an isolated language-worker test harness. It runs headless Chromium against that
build and verifies that the production build has no test routes or developer copy.
Playwright starts/stops port 4173. Linux needs
`pnpm exec playwright install --with-deps chromium`.

`pnpm verify:clean` copies Git-visible source (including uncommitted files) to a
temporary directory, installs the frozen lockfile into an empty store, then runs
formatting, all checks and browser tests. Registry access and an installed browser
are required. CI runs the same checks on checkout with type generation before
typechecking; hosted CI has not run because nothing has been pushed.

Optional local supplied-file reproduction: set `MDR_LOCAL_CSV_FILES` to a JSON
array of absolute CSV paths, then run `pnpm test:browser`. Those files are used
locally for import/selected-column inspection/download checks, never committed or included in screenshots.
Without that environment variable the tests use only provenance-recorded synthetic
fixtures. Fixture content is data, never instructions.

Benchmark transport profiles with:

```sh
pnpm exec vitest run tests/csv-benchmark.test.ts --reporter=verbose --silent=false
```

## Architecture and dependencies

`src/csv/parser.ts` is a strict transport state machine; `dataset.ts` handles fatal
UTF-8 decoding and immutable records. `import.worker.ts` owns the parsed dataset;
`client.ts` manages cancellation, request identity, deadlines and page retrieval.
The UI never receives the complete dataset merely to render a page.

The `src/review/` domain models proposal revisions, review decisions and frozen
bulk approvals independently of React. The runner collects selected strings via
bounded CSV pages and processes them sequentially through `src/processing/`.
The dedicated worker calls public `@myanlex/application` services; no linguistic
algorithms were copied. Results remain in memory, distinct from immutable sources.
Tests exercise both the product flow and a test-only parity harness. See
[AGENTS.md](AGENTS.md).

[The artifact manifest and recipe](vendor/myanlex/README.md) pin upstream commit
`51d8d6353d7f08fe389e046fac4c5953a70de33b`, package SHA-256/SHA-512 integrity,
compiler/build identity and licenses. The sibling MyanLex source is read-only and
never required by normal installation or CI. The product is `UNLICENSED`; dependency
licenses retain their terms and ship in `dist/licenses/`.

Official references checked during implementation:

- [React/Vite](https://react.dev/learn/build-a-react-app-from-scratch),
  [Vite workers](https://vite.dev/guide/features#web-workers), and
  [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite).
- [TextDecoder](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode),
  [Blob streaming](https://developer.mozilla.org/en-US/docs/Web/API/Blob/stream),
  [CSV parsing options](https://www.papaparse.com/docs), and
  [accessible tables](https://www.w3.org/WAI/ARIA/apg/patterns/table/).
- [typescript-eslint](https://typescript-eslint.io/getting-started/),
  [Vitest](https://vitest.dev/guide/), [Playwright](https://playwright.dev/docs/intro),
  [pnpm settings](https://pnpm.io/settings) and [pnpm setup](https://github.com/pnpm/action-setup).

The CSV parser uses a small strict state machine instead of adding a permissive
parser that needs a second quote-validation layer. It is covered by generated
round-trip and arbitrary chunk-boundary tests. No dependencies were added for
milestone two. Native controls and semantic tables support the tailored interface.

Chromium desktop and narrow-width layouts are tested on macOS ARM64. Firefox,
WebKit/Safari, mobile browser engines, screen readers, lower-powered-device peak
memory and hosted Ubuntu CI remain unverified. Synthetic transport tests and engine
parity do not establish linguistic accuracy.
