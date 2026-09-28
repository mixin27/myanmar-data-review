# Myanmar Data Review — product and implementation plan

Status: milestones one and two committed. Milestone three (local inspection,
proposals, review queues and approvals) implemented and locally verified.
Hosted CI and broader browser/accessibility verification remain pending.

This is a standalone product consuming MyanLex, not another developer playground.
Its purpose is to help one operator review legacy Myanmar text in CSV records,
preserve the source, approve changes deliberately, and export traceable results.
Demand and real-world usability still need validation with prospective users.

## Confirmed decisions

- Separate repository: github.com/mixin27/myanmar-data-review.
- First release: local-only processing. Optional API execution is deferred to a
  later release and its separate authentication/funding design gate.
- No automatic switching or fallback between execution modes.
- Unicode is the only conversion target in v1. Inspect first; conversion is
  explicitly enabled and NFC normalization defaults to off. Manual per-cell
  replacement is included and requires separate approval.
- Consume immutable, checksummed MyanLex application/core/types package archives
  contained in this repository, with source/build metadata and dependency notices.
  Hosted artifacts and registry publication are not required for v1.
- Device-local save/resume is included in the first release, by explicit consent.
- Preserve original values; uncertain or mixed encoding must not be silently repaired.
- Use synthetic test datasets with recorded provenance. Two user-supplied CSVs
  are now available for local troubleshooting only; do not commit or redistribute them.
- Milestone one was authorized and committed at the user's request as `92d0a98`.
  Milestone two was committed as `eaf8b57` at the user’s request. Milestone three
  is authorized: local inspection, proposed changes, review queues and approvals.
  Follow the delivery sequence; reviewed exports and save/resume remain next. No deployment, package publication, push or GitHub settings change is authorized.
- All product UI copy must be end-user focused. Remove developer status screens,
  raw JSON, build identities and worker terminology from production. Design for a
  coherent workflow with a clear hierarchy and next action; simplicity alone is
  not the design goal. Label original values separately from processing outcomes.
- Repository visibility: private. No open-source license for the product yet.
  This records intent only; changing GitHub settings remains separately authorized.
  Preserve dependency licenses and third-party notices in packaged artifacts.

## Proposed first-release scope

One operator reviews a CSV before importing it into another system. Include import,
column selection, encoding evidence, proposed changes, a review queue, approvals,
device-local projects, portable backups, and export/reporting. Exclude collaboration,
billing, scheduled migrations, spreadsheet workbooks, dictionary spelling correction,
grammar correction, arbitrary transformation scripts, and automatic mixed-text repair.

Suggested interface: projects screen, import wizard, dataset review table with filters,
cell inspection panel, processing settings, and export summary. Reuse the familiar
TypeScript/React, shadcn/ui, Tailwind, and theme approach from MyanLex where suitable.
Milestone one uses React + TypeScript + Vite and Tailwind, selected after checking
official documentation and package compatibility. The minimal integration screen
uses native controls; shadcn components and full product theming remain later UI work.

## 1. CSV import and integrity

- Initially support UTF-8 CSV, including an optional UTF-8 BOM. Decode strictly;
  reject invalid byte sequences instead of inserting replacement characters.
- Distinguish file character encoding, CSV delimiter, and Unicode/Zawgyi text encoding.
  They are different questions. A UTF-8 CSV can contain Zawgyi text.
- Preview delimiter and header handling, and require confirmation before import.
  Offer comma, semicolon, and tab delimiters. Never silently guess a file encoding.
- Preserve values as strings: identifiers, leading zeros, whitespace, empty cells,
  Myanmar numerals, quoted delimiters, and embedded newlines must survive.
- Address columns by stable positional IDs, not header names. Support empty and
  duplicate headers. Give rows stable IDs unrelated to their current sort order.
- Clearly flag malformed quoting and inconsistent column counts. Do not silently
  drop, pad, merge, or shift fields. The proposed first-release policy is to block
  malformed imports and explain the failing record/location.
- Preserve immutable source bytes for project backup/original download after the
  import passes resource limits. Reviewed CSV guarantees field-value fidelity, not
  identical quoting or line-ending bytes. Explain this distinction before export.
- Parse incrementally in a worker and cancel promptly. Establish file, row, column,
  and cell limits through measurements before advertising a capacity guarantee.
  Reject over-limit imports without leaving a partially usable project.

## 2. Processing and review semantics

- Users select text columns explicitly. Do not process identifiers or other columns
  merely because their contents resemble Myanmar text.
- Inspection records encoding evidence and supported structural diagnostics. It
  does not provide a universal text-quality or linguistic-accuracy score.
- Keep processing stages explicit and ordered: inspect original, optionally perform
  guarded conversion to the selected target, then optionally normalize Unicode.
  Expose NFC normalization and structural validation only for appropriate Unicode
  text; do not run them blindly on Zawgyi output.
- Conversion must validate its source. Mixed/uncertain input remains unresolved;
  target selection does not authorize guessing. Manual replacement may be proposed
  separately, with its author action distinguished from an engine transformation.
- Store original, proposal, diagnostics, and approval separately. Applying a result
  never overwrites the original. Approvals reference a specific proposal revision.
- Changing processing options, engine identity, or proposed content invalidates
  the associated approval. Old asynchronous results cannot update a newer revision.
- Separate processing state (not run/running/succeeded/failed/cancelled) from review
  state (unreviewed/approved/rejected/unresolved). A failure must not look unchanged.
- Support cell-level review and explicit bulk approval of a clearly described set.
  Filtering must never change which records a previously confirmed action targets.
- Associate every span with the exact string analyzed. MyanLex public offsets are
  Unicode code points, not JavaScript UTF-16 indexes.

## 3. Architecture and MyanLex integration

Keep product domain types and review transitions independent of the UI. Suggested
boundaries: CSV import/export, review domain, local execution adapter,
device storage, and UI. Add the API adapter only in the later API release.
A virtualized table displays a bounded portion of the data;
parsing and language processing must not run as long main-thread tasks.

Local execution calls @myanlex/application in workers; it delegates to @myanlex/core.
Do not copy or modify language algorithms here. Do not depend on MyanLex's private
playground package or internal session-authenticated playground endpoints.

The current MyanLex source is at ../myanlex. Its engine/application/SDK packages
are unpublished 0.0.0 previews and use workspace dependencies. A sibling source
import, machine-specific path, or version 0.0.0 alone is not a release dependency.

Before product features, establish a reproducible integration gate:

1. Select an immutable MyanLex source commit and build only the needed packages.
2. Prepare self-contained package artifacts with resolved inter-package dependencies,
   license notices, checksums, and source/build identity. Test their installation in
   a clean consumer without the MyanLex workspace present.
3. Store only the needed immutable package archives in this repository and pin
   them in the consumer manifest/lockfile. Resolve all transitive MyanLex package
   edges to those archives. Hosting and public registry publication are deferred.
   Do not commit unrelated source trees or mutable artifacts.
4. Verify worker bundling and local result parity against that exact engine build.

Current application limits include 100,000 code points per text, 1,000 batch items,
and 1,000,000 aggregate UTF-8 text bytes. Respect these and the HTTP body limit;
chunking must preserve stable row/column identities. Product resource limits may
be lower. Benchmark before selecting concurrency and cancellation deadlines.

## 4. Optional API processing — deferred, outside the first release

The requirements below are constraints for a future release, not first-release
acceptance gates. V1 has no API mode selector, server adapter, sign-in, or quota UI.

- Mode selection sends nothing. A separate Run confirmation identifies selected
  columns/cells, destination, and the fact that their text leaves the device.
- Send only required text and opaque correlation IDs, not whole files or unrelated
  columns. Keep text out of URLs, analytics, metrics labels, and application logs.
- Use MyanLex's public API contract/SDK through a narrowly scoped backend adapter.
  Never embed operator API keys in browser bundles or saved projects.
- API mode requires authenticated, authorized users and bounded admission before
  spending an operator/project allowance. Anonymous users retain local mode only.
- Authentication and key ownership are an open design gate: choose between an
  operator-funded service and supported user/project delegation before implementing
  API mode. Do not assume MyanLex already supports external-app SSO or delegated
  API access. Do not build new upstream auth APIs without explicit scope approval.
- No implicit retries after ambiguous timeouts. Cancellation may not stop admitted
  server work or refund quota. Show partial results and uncertain completion clearly.
- Record server request/build metadata where supplied; do not invent HTTP metadata
  for local runs or assume parity across different engine builds.

## 5. Explicit local save/resume and privacy

- Ordinary unsaved work stays in memory. Saving a project explicitly authorizes
  storage in this browser profile, with a clear explanation of what is retained.
- Proposed storage: IndexedDB with a versioned schema and transactional checkpoints.
  Save updates explicitly by default; do not infer consent to automatic persistence.
- Explain that device storage can be cleared/evicted and is not a backup, cloud sync,
  or a confidentiality boundary against another user of the same browser profile.
- Provide portable project backups containing source data, selected columns,
  settings, proposals, review decisions, stable IDs, and engine/build metadata.
- Define a versioned backup format, validate imports as untrusted input, and bound
  bytes, records, nesting, and any decompression. Never execute an imported snapshot.
- Reopening restores a checkpoint without processing. Resume pending work explicitly;
  re-running with a different engine creates new proposals requiring fresh approval.
- Handle storage exhaustion, interrupted saves, stale tabs, and schema upgrades.
  First-release default: only one active writer per saved project.
- Provide deletion of a project's device records and explain that downloaded backups
  are separate copies. Do not claim secure erasure of the user's disk.
- Warn before leaving unsaved work. Online page loading is the proposed default;
  offline reload/PWA support is not promised without a separate implementation scope.

## 6. Exports and traceability

- Export all rows in original order by default, with only explicitly approved cell
  proposals replacing original values. Rejected/unreviewed/unresolved cells retain
  originals. Exporting a filtered subset requires an explicit separate selection.
- Show counts of changed, unresolved, failed, and unreviewed cells before export.
  Do not label an export all-Unicode/all-Zawgyi when retained unresolved cells mean
  the requested target was not established throughout the selected columns.
- Offer clearly distinct data-preserving and spreadsheet-safe CSV exports. The
  spreadsheet-safe mode may alter risky field values; disclose exactly which ones
  and record that in the report. Quoting CSV alone is not formula mitigation.
- Export a processing report with source fingerprint, schema/engine/build identities,
  options, stage ordering, and review counts. Include text in reports only through
  explicit selection. Report exports are user-controlled records, not tamper-proof
  audits or evidence of independent linguistic validation.
- Bound previews, not downloads: exports must include all selected approved results.
  Preserve originals through a separate original-file download/project backup.

## 7. Synthetic fixtures and verification

Record provenance and redistribution permission for every committed fixture. Use
project-authored synthetic transport cases and permitted MyanLex linguistic fixtures.
Do not invent linguistic expected results or equate passing tests with accuracy.

Cover Unicode/Zawgyi/mixed/uncertain text; leading-zero IDs; empty/duplicate headers;
empty/ragged records; quotes, delimiters and multiline fields; BOM/invalid UTF-8;
emoji, malformed Unicode, bidi/control characters and hostile markup; spreadsheet
formula risks; cancellation; partial failures; and generated large datasets.

Acceptance gates:

- CSV round-trip property tests preserve field values and row/column identity.
- Review transitions, approval invalidation, and stale response suppression are tested.
- Local processing emits no text-bearing network traffic or automatic storage writes.
- Storage tests exercise interrupted checkpoints, quota errors, reopen, deletion,
  concurrent tabs, and malformed/version-incompatible project backups.
- Export tests prove only approved changes are applied and complete data is retained.
- V1 verifies local worker results against direct execution of the matching build.
  Local/API parity and auth/quota/outage tests belong to the later API release,
  using isolated services once its integration model is approved.
- Fresh-checkout CI generates framework types before typechecking, then runs lint,
  tests, production builds, worker checks, and package-consumer integration tests.
- Use automated DOM/keyboard tests. Do not use computer-use tools unless requested.
  Record remaining real-browser, accessibility, memory, and visual verification.

## Implementation baseline

These implementation defaults make the remaining behavior concrete and remain
open to revision. Explicit user decisions are recorded separately above. The current
implementation authorization covers milestones one through three, not the full baseline.

- **Application:** React + TypeScript + Vite, with the proposed shadcn/ui and
  Tailwind approach. Build a static browser application with worker-based local
  execution; a server-rendering framework is unnecessary for the v1 workflow.
  Pin compatible versions during scaffolding. Vite supports static production
  bundles: https://vite.dev/guide/build.
- **Initial audience:** desktop browser users preparing Burmese CSV data for
  import. Use English interface copy initially, with Myanmar-capable text rendering
  and keyboard-accessible review. Do not market conversion as supporting every
  language or legacy font that uses Myanmar script. Mobile-specific layouts and
  translated interface copy are later scope. Confirm supported browser versions
  through implementation verification before release.
- **Review semantics:** rejection means keep the original for export, not that its
  encoding is verified. Acknowledging an unresolved original must not erase its
  diagnostic status. Keep diagnostic resolution separate from approval/rejection.
  A manual edit creates a new proposal, records manual provenance, and requires a
  separate approval action; it cannot acquire an engine-verified claim merely by
  being approved. No global find/replace in v1.
- **Bulk actions:** allow approval only of completed, changed engine proposals
  without blocking diagnostics. Manual proposals require individual approval.
  Confirm the cell count and freeze cell IDs plus proposal revisions. If any
  revision changes before the action applies, cancel that action and require a
  refreshed confirmation. Support revoking approval without deleting the proposal.
- **CSV edge cases:** preserve blank records as parsed records; if their field
  count conflicts with the confirmed schema, block import. A terminal record
  separator does not create an extra record. Header cells are preserved metadata,
  excluded from processing. Empty files and header-only files have no reviewable
  records and receive a clear import error.
- **Exports:** default to data-preserving UTF-8 CSV, original delimiter and header
  choice, original row order, explicit BOM option, and documented CRLF record
  separators. Preserve embedded field newlines. Keep spreadsheet-safe export a
  separate choice with a specified and tested escaping policy before shipping it.
  Retained unresolved/failed cells require acknowledgement in the export summary,
  but do not prevent exporting other approved changes. Generate a versioned JSON
  report with no cell text by default, including a manifest of applied cell IDs
  and proposal revisions. Report generation does not save a project locally.
- **Storage and backup:** explicit Save/Save changes only. Use atomic IndexedDB
  checkpoints and a single-writer lease; additional tabs open read-only. Backups
  use versioned, uncompressed JSON with base64 source bytes and bounded parsing;
  account for base64 overhead in backup limits. Downloading or opening a backup
  does not implicitly consent to device storage. An imported backup opens as a
  new unsaved project; never overwrite an existing project by its imported ID.
- **Privacy:** no analytics, remote font loading, or automatic error uploads in
  v1. Bundle runtime assets. Local processing sends no dataset text over the
  network; ordinary online application loading remains allowed.
- **Release evidence:** establish numeric resource limits and cancellation targets
  from benchmarks before release, not as invented capacity promises during
  planning. Synthetic tests demonstrate mechanics; observe at least one prospective
  operator complete import, ambiguous-cell review, save/reopen, and export before
  claiming workflow validation. Record remaining usability and linguistic limits.

The confirmed dependency approach is repository-contained immutable package
archives. Include application/core/types, checksums, source commit,
build recipe/tool versions, and dependency notices. Resolve every package edge to
the pinned archives in the consumer; ordinary `pnpm pack` rewrites workspace
references to versions and alone does not make unpublished dependencies available
(https://github.com/pnpm/pnpm.io/blob/main/docs/workspaces.md). Prove installation
and build with no sibling workspace or prepopulated package cache.

Pinned MyanLex integration: `51d8d6353d7f08fe389e046fac4c5953a70de33b`.
The repository contains verified package archives for this commit, versioned
`0.0.0-mdr.51d8d6353d7f`. This is an integration baseline, not a production-readiness
or independent linguistic-validation claim.

## Milestone one progress — 2026-09-27

Implemented:

- React 19.3 / Vite 8.3.1 / TypeScript 6.0.3 scaffold with Tailwind, pnpm 12.4.2,
  ESLint, formatting, separate browser/worker type checks, Vitest, and Playwright.
  Exact versions and integrity are pinned in the manifest and lockfile.
- Fresh-checkout GitHub Actions configuration: verify artifact integrity, install
  the frozen lockfile, generate typed engine identity before typechecking, lint,
  tests, production build, isolated consumer install, and Chromium browser tests.
- A read-only upstream packaging recipe builds only types/core/application from
  immutable Git objects in a temporary directory. Archives contain declarations,
  compiled engine code, build identity and notices. SHA-256, source tree IDs and
  recipe/compiler identity are in `vendor/myanlex/manifest.json`; pnpm additionally
  locks archive SHA-512. No source algorithms or upstream files were modified.
- Dedicated module worker with explicit inspection/guarded Unicode conversion/NFC
  ordering, upstream input validation, uncertainty retention, and diagnostics tied
  to their exact input strings. Main-thread engine imports are rejected at build.
- One worker per run; termination on cancellation, completion, failure or timeout;
  explicit recovery by a new run; request/revision checks and UI invalidation protect
  against stale replies. The 30-second safety timeout is provisional and unbenchmarked.
- Minimal memory-only integration screen. No CSV, review approvals, saving,
  authentication, API mode, analytics or remote font loading.
- Project `AGENTS.md` records integration rules, scope and verification requirements.

Verified locally:

- Lint, generated types, browser/worker typecheck, 33 unit/integration tests,
  production worker bundling and shipped notices.
- Offline archive install in a clean consumer with an empty package store;
  runtime execution restricted by Node filesystem permissions to that consumer,
  excluding the sibling MyanLex repository.
- Byte-identical repeat archive build on the same macOS ARM64 toolchain.
- Five automated Chromium tests against production assets: service parity,
  conversion/NFC, keyboard execution, cancellation, stale-result invalidation,
  timeout, worker startup failure and explicit recovery. Network observation and
  window/worker instrumentation detected no processing upload or automatic storage
  write; reload restored no entered text.
- `pnpm verify:clean` passed from an isolated snapshot of Git-visible uncommitted
  source, with no generated types, node_modules, build output or sibling source.
  Frozen installation downloaded into an empty store, followed by formatting,
  generation, lint, both typechecks, all 33 unit/integration tests, production build,
  offline consumer verification, and all five Chromium tests. No commit was needed.

Remaining verification: GitHub-hosted Ubuntu CI has not run (no push authorized).
Firefox, WebKit/Safari,
mobile, screen readers, visual typography inspection, cross-platform artifact
regeneration, and large-input resource/cancellation benchmarks remain unverified.
No necessary upstream changes or essential unresolved milestone-one product
decisions were found. Future API authentication and CSV/export details do not block
this milestone.

## Milestone two progress — 2026-09-28

Implemented:

- A redesigned three-step import flow: choose file, confirm delimiter/header layout,
  choose text columns. No columns are selected automatically. A responsive file
  overview displays original values, selection controls and original-file download.
- All production content is user-facing. The old engineering screen now exists only
  in the integration-test build. “No changes applied” was removed: importing a file
  is not a completed language review. This milestone ends at “File ready for review”.
- Strict UTF-8 decoding in 64 KiB chunks, optional BOM, an incremental strict CSV
  parser in a dedicated worker, and immutable string records. No implicit trimming,
  type conversion, quote repair, row padding or skipped blank records.
- Comma/semicolon/tab support, duplicate/empty headers with positional column IDs,
  stable source-record IDs, SHA-256 source fingerprint, exact original-byte retention,
  malformed-quote/ragged-record errors with record/line/field locations, and no
  partially usable import after failure. A terminal record separator adds no extra row.
- Worker termination on cancel/timeout/failure, revision protection on option
  changes, explicit retry, bounded five-row layout preview and 25-row table pages.
  Parsed records stay in the worker; only visible pages cross to the UI.
- File replacement confirmation and browser-native unsaved-work navigation warning.
  No automatic persistence or processing network requests.
- Import resource guards: 10 MiB, 50,000 data rows, 100 columns, 500,000 fields
  including headers, and 100,000 UTF-16 code units per value. These are conservative
  implementation guards, not a cross-device performance guarantee. The 30-second
  timeout covers an import/page request; cancellation terminates that worker.

Measurements and verification:

- Representative Node/macOS ARM64 import profiles after memory optimization:
  50,000 × 5 values (1.4 MB): 78 ms / 16.2 MiB heap delta; 100 columns × 4,999 data
  rows (2 MB): 114 ms / 17.4 MiB; a 10.4 MB long-field profile: 419 ms / 60.3 MiB.
  Heap deltas are not peak/browser memory measurements. The long-field profile
  informed the bounded character accumulation strategy before setting the guard.
- Chromium imported and paged a 50,000-row synthetic file in about 0.7 seconds on
  this host, rendering only 25 rows. This is an observed test, not a latency promise.
- Unit/property checks cover quoted delimiters/newlines, escaped quotes, chunk
  boundaries, BOM/invalid UTF-8, emoji, leading zeros, duplicate/empty headers,
  hostile-looking markup, formula-like strings, resource limits and worker recovery.
- Automated Chromium tests cover keyboard navigation, layout/header changes,
  explicit selections, cancellation/retry, original downloads, privacy, pagination,
  and desktop/narrow layout overflow. Synthetic-data screenshots are used for visual
  review. User-supplied files are tested only through an opt-in local test path.
- `pnpm verify:clean` passed in an isolated source snapshot with an empty package
  store: frozen install, formatting, generation, lint, both typechecks, 55 tests,
  production build, isolated installed-artifact consumption and 12 Chromium tests.
  No sibling source or pre-existing generated output was used.
- A separate Chromium run passed all 14 tests, including both opt-in local CSV
  checks. The supplied files imported 611 and 508 data rows respectively; original
  downloads matched their source bytes exactly. Source contents are not committed.
- Desktop and narrow screenshots made from synthetic data were visually reviewed.
  Milestone two was subsequently committed as `eaf8b57` at the user’s request.

Still outside this milestone: language findings in the product, conversion
proposals, cell/bulk approval, save/resume and reviewed exports. The next milestone
must provide these review semantics together rather than treating import status as
an analysis result. Paged previews must not become a limit on eventual processing
or export completeness. Hosted Ubuntu CI, Firefox/WebKit, screen-reader testing,
and peak-memory measurements on lower-powered devices remain unverified.

## Milestone three progress — 2026-09-28

Implemented:

- Inspection of every selected cell, independently of the paged preview. Optional
  guarded Unicode conversion and NFC remain off until an initial inspection ends.
  Original and proposed values appear side by side in the review table and cell view.
- Separate processing status, original encoding/structural evidence, proposal,
  provenance, decision and approval revision. Mixed/uncertain text and structural
  findings stay unresolved; keeping originals or approving manual replacements
  does not erase those findings or claim verified linguistic correctness.
- Needs-attention, proposed-change, approved, kept-original and all-cell queues,
  bounded to 25 displayed cells. Cell evidence uses exact analyzed strings with
  code-point spans, including supplementary characters. At most 100 evidence
  segments/diagnostics are displayed per detail group, explicitly labelled when
  bounded; complete evidence remains retained for later reporting.
- Manual replacements create proposals with separate approval. Bulk approval
  confirms a frozen set of eligible automatic proposal IDs and revisions; stale
  snapshots fail atomically. Decisions can be revoked. Settings changes and new
  inspections explicitly clear previous proposals/approvals; changing columns
  warns before discarding the current review.
- A single dedicated language worker is reused sequentially within one review.
  It is terminated on stop, timeout, worker failure or completion. Each cell keeps
  request/revision checks and a 30-second deadline. A failed worker stops the run
  without retry; completed findings survive, the failed cell remains failed and
  remaining cells are marked cancelled. A new review explicitly retries originals.
- MyanLex continues through unchanged pinned public package artifacts. The product
  adapter now retains original structural validation separately from output
  validation. No linguistic algorithm, package identity or upstream source changed.
- Current review guards: 10,000 selected cells and 16,000,000 serialized result
  UTF-16 code units (roughly 32 MB of string payload, not a heap-size guarantee).
  The cell count is checked before collecting review values. Result-budget exhaustion
  stops with explicit partial status, preserving completed findings. Operators can
  select fewer columns or split files. Import limits are unchanged; no preview limit
  silently truncates a review. Full selected-cell results are retained in memory;
  full unselected data stays in the CSV worker.

Verification so far:

- Unit tests exercise uncertainty, revisions, approval invalidation, frozen bulk
  actions, manual provenance, immutable originals, exact spans and partial failures.
- Node retained-review measurements on this host: 10,000 short plain-text cells
  completed in 39 ms with a 15.2 MiB heap delta; 10,000 representative Myanmar
  Unicode cells in 222 ms with a 23.9 MiB delta. A previous 20,000-cell plain-text
  trial reached the result budget after 19,184 cells; the supported cell guard was
  reduced to 10,000. These are synthetic observations, not browser peak-memory or
  cross-device latency promises.
- The expanded Chromium suite passed 20 tests, including both supplied CSVs
  imported and inspected through the selected column, with byte-identical original
  downloads. A 10,000-cell plain-text review completed in approximately 1.4 seconds
  on this host; only 25 result rows rendered at a time. All selected rows were included.
- Browser tests cover the complete review/approval flow, bounded queues, cancellation,
  startup failure and explicit recovery, resource rejection, and original/proposal
  parity with the pinned services. Both CSV/language workers and the window were
  instrumented for processing requests and automatic storage writes; none occurred.
- `pnpm verify:clean` passed: empty-store frozen install, generated types, formatting,
  lint, both typechecks, 69 tests across seven files, production build and worker
  separation, isolated offline artifact consumption, and all 18 standard Chromium
  tests. The separate supplied-file run passed 20 browser tests as recorded above.
- Synthetic desktop/narrow screenshots were visually reviewed. No supplied-file
  text was committed or included in screenshots. Nothing was pushed, published or deployed.
- Follow-up UI fixes center the cell dialog, keep it within the viewport, correct
  text pagination widths and align settings controls. Encoding uncertainty now
  explains that numerals, punctuation and short words may share both encodings;
  it does not imply incorrect text. Conversion-disabled status is distinct. The
  upstream detector, unresolved evidence and approval rules remain unchanged.
- After these fixes, `pnpm check` passed with 70 tests, and `pnpm test:browser`
  passed all 19 standard Chromium tests. Dialog positioning, scrolling and button
  widths were tested at 1440, 1024 and 390 pixels; synthetic dialog screenshots
  were visually reviewed. The earlier clean-source and supplied-file checks above
  predate these UI-only fixes.

Reviewed export, reports, explicit saving/resuming and portable backups are the
next milestone. No new dependency or essential unresolved decision was needed.
Hosted CI, Firefox/WebKit, screen readers, low-powered device peak-memory profiling,
and independent linguistic/operator validation remain outstanding.

## Delivery sequence

1. On a follow-up implementation request, use the confirmed local-only,
   Unicode-focused scope and repository-contained package archives. Private
   visibility and no open-source product license are confirmed. API authentication
   decisions do not block v1.
2. Scaffold the app and CI; prove clean MyanLex artifact consumption and worker use.
3. Implement lossless CSV import, immutable records, preview, and column selection.
4. Implement local inspection, proposed changes, review queues, and approvals.
5. Implement safe exports, reports, explicit save/resume, and portable backups.
6. Benchmark, verify failure recovery/accessibility, document limits, and conduct
   user validation before claiming production readiness.
7. In a separately scoped later release, implement optional authenticated API
   execution after its design gate is resolved.

The user need not purchase a domain, provision hosting, publish packages, or supply
production credentials. The next milestone is safe reviewed exports, reports, explicit save/resume and
portable backups, following the confirmed integrity and approval semantics.
