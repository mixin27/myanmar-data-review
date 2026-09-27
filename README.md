# Myanmar Data Review

Private, local-only browser application for deliberate Myanmar text review.
Milestone one provides a minimal integration screen, not the CSV product.

Implemented: React/TypeScript/Vite scaffold, Tailwind, lint/type checks, tests,
fresh-checkout CI, pinned MyanLex package archives and dedicated worker execution.
CSV import, review approvals, persistence, authentication and API mode are excluded.
No deployment or publication is configured.

## Run locally

Use Node **24.21.0** (`nvm use`) and pnpm **12.4.2**. With those installed:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the localhost URL printed by Vite. `pnpm dev` verifies the archives and
regenerates typed build identity before starting. No environment files, credentials,
MyanLex checkout, sign-in or processing API are needed. Dependency installation
needs the npm registry; processing uses bundled assets and no network service.

The screen defaults to inspection. Guarded Unicode conversion and NFC are explicit
unchecked options. Unknown/mixed text is retained. Results are previews, not
approvals or independent linguistic validation. Text stays in memory and disappears
on reload. Platform fonts are used; no fonts are downloaded.

## Verify

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
pnpm format:check
pnpm verify:clean
```

`pnpm check` generates build identity, lints, typechecks browser and worker scopes,
runs unit/integration tests, builds production assets, checks worker separation and
licenses, then installs the archives in an offline temporary consumer with an empty
package store. That consumer runs with Node filesystem permissions restricted to
its temporary directory, excluding the sibling MyanLex source.

`pnpm test:browser` tests the production build using headless Chromium; run
`pnpm build` after editing runtime code. Playwright starts/stops its own preview
server on port 4173. On Linux, install browser OS dependencies with
`pnpm exec playwright install --with-deps chromium`.

`pnpm verify:clean` copies Git-visible source files (including uncommitted files)
to a temporary directory, excluding ignored files. It installs the frozen lockfile
using an empty store, then runs formatting, all checks and browser tests. No commit
is needed. Registry access and the installed Playwright browser are required.

The GitHub Actions workflow performs these individual checks on checkout, including
browser installation. It generates types before typechecking and does not restore
a dependency cache. Hosted CI has not been executed during this implementation.

## Integration architecture

`src/processing/contracts.ts` defines requests/results without runtime engine
imports. `execute.ts` implements product stage ordering around public
`@myanlex/application` methods. `engine.worker.ts` is the only application runtime
entry for those services. The UI depends on `browser-client.ts` and
`worker-client.ts`; the production build rejects engine modules in its main-thread
module graph. No SDK, playground package or internal endpoints are dependencies.

Each request owns a fresh module worker. Completion, cancellation, timeout, worker
errors and deserialization failures terminate it. Starting another run supersedes
the old one. Request IDs and input revisions reject late replies, and UI revisions
prevent edits/cancellation from being overwritten by old promise callbacks.
Recovery is an explicit new run, never a retry or execution-mode switch.

The **30-second timeout is a provisional safety deadline**, not a benchmark or
capacity promise. This milestone processes one text per run, up to the upstream
100,000-code-point limit. Batch sizing and CSV resource limits remain future work.
Input validation runs in the worker. Every diagnostic result retains its analyzed
input; spans use Unicode code points. No storage, telemetry, or network client is
part of local processing.

## Pinned dependencies and provenance

See [vendor/myanlex/README.md](vendor/myanlex/README.md) and its manifest for package
checksums, source commit, build recipe, notices and regeneration instructions.
The product is `UNLICENSED` and private. Dependencies retain their own licenses;
MyanLex's MIT notice and Apache-2.0 component notices ship in `dist/licenses/`.

New dependencies were selected after checking the official documentation:

- [React with Vite](https://react.dev/learn/build-a-react-app-from-scratch),
  [Vite workers](https://vite.dev/guide/features#web-workers), and
  [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite).
- [typescript-eslint](https://typescript-eslint.io/getting-started/),
  [Vitest](https://vitest.dev/guide/), and [Playwright](https://playwright.dev/docs/intro).
- [pnpm configuration](https://pnpm.io/settings),
  [pnpm's setup action](https://github.com/pnpm/action-setup),
  [Node setup](https://github.com/actions/setup-node), and
  [checkout](https://github.com/actions/checkout).

Exact versions are in `package.json`/`pnpm-lock.yaml`: React 19.3, Vite 8.3.1,
TypeScript 6.0.3, Vitest 5.0.2 and Playwright 1.63.0. TypeScript 6 matches the
upstream compiler and typescript-eslint's supported peer range; the newest major
was not selected automatically. shadcn components and full product theming are
left for the product UI milestone; this screen uses native accessible controls.

## Verification limits and next work

Local automated evidence covers Chromium on macOS ARM64. Firefox, WebKit/Safari,
mobile browsers, screen-reader testing, visual typography inspection, long-running
resource benchmarks and the Ubuntu hosted CI run remain unverified. Unit tests
exercise malformed Unicode and stale callback races; browser tests exercise real
workers, startup failure, cancellation, simulated timeout and network/storage
instrumentation. These tests do not establish linguistic accuracy.

Next milestone: strict UTF-8 CSV import, immutable source/record identity, delimiter
and header preview, and explicit text-column selection, with resource limits based
on measurements. See [PRODUCT_PLAN.md](PRODUCT_PLAN.md).
