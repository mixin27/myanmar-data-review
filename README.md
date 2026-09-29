# Myanmar Data Review

A private, local-first workflow for carefully reviewing Myanmar text in CSV files.
Open a CSV, confirm its layout, choose text columns, then inspect encoding and
Burmese structure. Review proposed Unicode changes and approve them deliberately.
Original values and source bytes remain preserved.

The interface now follows a three-step import flow. Engineering test screens,
raw diagnostics and build identities are excluded from the product build.
“File ready for review” means import is complete; it does not mean that language
inspection or conversion has run. Choose Inspect selected text to see findings.
Reviewed CSV exports, reports, explicit local saving and portable backups are now
available. Release hardening is next in [PRODUCT_PLAN.md](PRODUCT_PLAN.md).

## Run

Use Node **24.21.0** (`nvm use`) and pnpm **12.4.2**:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. No environment files, credentials, MyanLex
checkout, authentication or processing API are needed. Text stays in memory unless you explicitly choose Save project or Save changes. Download original returns the exact source bytes;
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
to each cell, not the whole dataset. Reviews and approvals remain in memory until an explicit Save action.

Inspect first. Then enable Propose Unicode conversion or Normalize Unicode (NFC)
if desired and run inspection again. Starting a new review clears previous findings,
proposals and approvals after confirmation. Use the review queues and individual
cell view to approve changes, keep originals, or propose manual replacements.
Unresolved findings remain visible after manual decisions. Download original always
returns the unmodified input, including after approval.

## Export, save and restore

- **Export reviewed CSV** includes every row in original order. Only approved
  proposals replace originals. This includes approved manual replacements even
  when original findings remain unresolved; those findings stay in the report.
- Review the counts and acknowledge unfinished/unresolved work. Choose data-value
  preservation or explicit spreadsheet escaping, and an optional UTF-8 BOM.
  Escaping prefixes an apostrophe before formula-like values (including after
  whitespace), leading tabs/newlines, and their fullwidth formula variants. Headers
  are included. It changes values and cannot guarantee behavior in every spreadsheet
  app or after re-saving; the report lists every affected row and column.
- **Download report** is separate from CSV download. Reports contain metadata and
  cell IDs/revisions by default. Including applied original/replacement text is opt-in.
- **Save project** confirms storage of the complete checkpoint in this browser.
  Later changes require **Save changes**. Storage is not cloud sync or a backup and
  is accessible to others using the same browser profile. Browser clearing/eviction
  may remove it. **Delete saved project** removes that record, not downloaded copies.
- **Projects & backups → Show saved projects** lists local checkpoints. Opening one
  restores its review without inspection. A second tab opens read-only; close the
  owning tab and reopen to edit. Web Locks is required for writing saved projects.
- **Download backup** creates a complete portable JSON file without saving locally.
  **Open backup** validates it and opens a new unsaved project. It does not overwrite
  another project. A new inspection is always explicit and clears old approvals.

Backups and export/report outputs are limited to 96 MiB. Restore checks depth (20),
JSON node count (two million), file fingerprint, CSV limits, identities, evidence
spans, stage consistency and approval revisions. Project-file work happens in a
separate worker with a 30-second deadline and cancellation. Checkpoints are user
records, not signed/authenticated proof of linguistic correctness.

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
an isolated language-worker test harness. It runs headless Chromium, Firefox and WebKit against that
build and verifies that the production build has no test routes or developer copy.
Playwright starts/stops port 4173. Linux needs
`pnpm exec playwright install --with-deps chromium firefox webkit`.

`pnpm verify:clean` copies Git-visible source (including uncommitted files) to a
temporary directory, installs the frozen lockfile into an empty store, then runs
formatting, all checks and browser tests. Registry access and an installed browser
are required. CI runs the same checks on checkout with type generation before
typechecking; hosted CI has not run because nothing has been pushed.

Optional local supplied-file reproduction: set `MDR_LOCAL_CSV_FILES` to a JSON
array of absolute CSV paths, then run `pnpm test:browser`. Those files are used
locally for import, selected-column inspection, all-row export, backup and original
download checks; never committed or included in screenshots.
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
Tests exercise both the product flow and a test-only parity harness.
`src/project/` owns file generation/validation and explicit storage. IndexedDB
checkpoints and listing metadata commit atomically; version-one databases migrate
to version two without dropping projects. Writer locks and revision comparisons
prevent stale tabs from overwriting a checkpoint. See
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

Chromium and WebKit desktop/narrow workflows are tested on macOS ARM64. Firefox
verification is blocked locally on macOS 27.0: its installed browser exits before launch with
“Could not find profile folder,” including when using `/private/tmp`. The symptom matches an upstream startup issue; see the release guide for evidence.
The full suite keeps Firefox enabled so this failure remains visible. To run the available engines:
`pnpm test:browser --project=chromium --project=webkit`.
Shipping Safari/iOS, screen readers, lower-powered devices and hosted Ubuntu CI
remain unverified. Synthetic tests and engine parity do not establish linguistic accuracy.

See [release validation and recovery](docs/RELEASE_VALIDATION.md) for recovery steps,
operator tasks and outstanding release gates. `pnpm benchmark:browser` samples the
Chromium test process tree's memory on macOS/Linux; this includes test tooling and
shared pages and is not a precise application peak or a device capacity guarantee.

Milestone-four references: [IndexedDB transactions and version changes](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB),
[Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), and
[OWASP CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection).
No new dependency was added for export, storage or backups.

## Static preview preparation

See [static hosting handoff](docs/STATIC_PREVIEW.md). `pnpm test:production` tests
the real production build with the policy in `deployment/headers.json`. After
`pnpm build`, use `pnpm preview:secure --port 4174` to try it locally. This is not
a production server or a deployment. Host/CDN headers must be configured separately.
