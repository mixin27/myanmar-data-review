# API mode and authentication — approval proposal

Status: historical proposal; API mode and authentication are deferred at the user's
request. Separate Data Review accounts and operator-funded access were accepted in
conversation. The user also requested production-oriented portable Docker deployment;
the SQLite suggestion below was superseded by a PostgreSQL/Redis direction. No runtime
was implemented. This document is retained as context, not current implementation
approval. Local-only validation is the active priority; release checks remain open.

## Inspected upstream

Reference commit: `51d8d6353d7f08fe389e046fac4c5953a70de33b`, matching the
currently vendored local engine source. Read `AGENTS.md`, `openapi/openapi.yaml`,
`docs/authentication.md`, `docs/limits.md`, scoped-key/distributed-quota decisions,
`apps/api/README.md`, account-auth configuration, and SDK README/transport.

- Account sessions belong to the MyanLex portal. Google/GitHub sign-in there is
  not an external-app identity provider or delegated API authorization protocol.
- Language routes use bearer project keys with `api.invoke`. Project keys retain
  their grants after their creator loses membership; revoke them explicitly.
- Quotas default off. Only persisted keys consume organization monthly quotas;
  bootstrap keys and account sessions bypass them. Use a dedicated test organization
  and project, a persisted scoped key and enabled quotas for acceptance testing.
- Default burst limit is 60 requests/minute/key. Monthly defaults are 10,000
  requests and 1,000,000 code points shared across an organization. Reservations
  occur before handler validation; errors/disconnects do not imply refunds.
- SDK has no automatic retries. It is unpublished, uses workspace types, and
  excludes user login and organization/quota administration.
- Public health returns a configured service version, not authenticated engine
  commit/artifact identity. Do not use private playground build metadata as a shortcut.
  No public combined inspection/conversion/validation endpoint exists; one cell can
  require multiple calls, each separately counted.

## Recommended decisions requiring approval

1. Separate, operator-provisioned Data Review email/password accounts using Better
   Auth. No public signup, social login, shared MyanLex cookies or account linking.
   A local administrative CLI provisions/disables users and resets passwords with
   session revocation; no SMTP service is required in this development milestone.
   Each user has an explicit server-side API-enabled flag. Database-backed sessions
   last at most eight hours, with no cookie-only authorization cache. Local review
   stays anonymous and independent. Tradeoff: separate login and manual onboarding.
2. One operator-funded MyanLex project with a dedicated persisted `api.invoke` key.
   Data Review users never receive the key or MyanLex membership. All admitted work
   spends the operator's allowance. Tradeoff: the operator funds usage and must
   manage access/caps. User-connected projects are deferred: securely collecting,
   encrypting, rotating and isolating many keys is additional scope; no delegated
   authorization flow was found upstream.
3. One loopback-only Node/TypeScript Fastify adapter, Better Auth and a dedicated
   SQLite database for users, hashed credentials, sessions and durable numeric
   admission counters only. Store the MyanLex key and auth secret in an ignored
   server-only environment file outside Vite's source/public/env loading paths.
   Never place credentials in VITE_* variables or serialize them to the browser,
   logs, URLs, project saves, reports or backups. This is a single-instance local
   development architecture; multi-instance hosting would require a separate gate.

Proposed conservative development allowances (configurable by the operator, never
by browser parameters):

| Control                                           | Per user | Whole adapter |
| ------------------------------------------------- | -------- | ------------- |
| Concurrent cell executions                        | 1        | 2             |
| Upstream request admissions/minute                | 30       | 45            |
| Upstream request admissions/UTC day               | 1,000    | 5,000         |
| Submitted code points/UTC day, counted each stage | 100,000  | 500,000       |

Counters reserve atomically before each upstream request and persist across restart;
fail closed if storage is unavailable. Do not refund ambiguous outcomes. Upstream
organization monthly quotas are an additional hard bound, not a replacement for
per-user admission. These bound request/character consumption, not monetary billing;
no pricing contract or automatic top-up is assumed. No unbounded server queue.

Also bound login attempts by account and actual peer IP, never untrusted forwarded
headers. Start with five failed attempts per account and twenty per IP per 15 minutes,
with generic errors and no permanent lockout. Reject oversized bodies before parsing:
one selected cell/request, max 10,000 code points and 64 KiB JSON; bounded upstream
responses, 10-second upstream deadlines and 30-second total cell deadline. Recheck
session validity/API permission before every upstream stage and before returning a
result. Logout/expiry discards client work and stops subsequent calls; already
admitted upstream work may finish and consume quota.

## Data flow and security boundaries

Preserve Vite and existing local workers. Vite proxies only a fixed Data Review
backend prefix on the same origin. Session cookies are HttpOnly, SameSite and
host-only; Secure outside explicit loopback HTTP. Validate Host/Origin, retain
Better Auth CSRF checks, and require an anti-CSRF token for processing mutations.
No wildcard CORS, arbitrary destination URL, user-supplied key or generic proxy.

Use native server HTTP against a pinned public contract, avoiding a new SDK artifact.
Allow only POST `/v1/text/detect`, `/v1/text/convert` (Zawgyi to Unicode with source
validation), `/v1/text/normalize`, and `/v1/orthography/validate`, plus public health
for version display. Disable redirects and cookie forwarding. Validate requests
and response shapes/spans. Compose existing product stage policy without copying
linguistic algorithms. Reserve quotas for transformed text too; never estimate all
stages from the original length. Redact errors and disable body/header logging.

Selecting API mode sends nothing, including no session or version request. A separate
sign-in action may contact auth endpoints. Explicit Run confirmation identifies the
selected cell count/columns, destination, repeated processing stages and uploaded text.
Only selected text, opaque per-run cell IDs and required options cross the boundary.
No files, filenames, headers, unrelated columns, document history or server result store.
Transient processing buffers expire with the request. Counters contain no cell IDs/text.

No automatic retries, including quota errors and ambiguous failures. Show partial
results and distinguish session expiry, revoked access, 403, 429, quota exhaustion,
timeout, invalid response and outage. Cancellation is best effort, not a refund.
Switching modes invalidates the run and approvals as appropriate, cancels requests
and rejects late responses; never fall back to the other mode. Reuse existing
original/proposal/review rules and revision checks. Backups/reports gain versioned
API provenance without any authentication material; old local backups remain readable.

## Integration and verification after approval

Refactor the current local-only runner/result identity boundary to support an
explicit execution adapter. Keep local engine imports in its dedicated worker and
local mode the default even when the backend is unavailable. Distinguish public
service version from operator-declared source identity. Unknown/mismatched builds
must be visible; do not present a configured version string as verified parity.
For matching-build parity tests, build an isolated MyanLex checkout from the pinned
commit, preserving licenses and original source without writing to the reference.

Test authorization/CSRF/key isolation, disabled users, cross-user session isolation,
expiry/logout between stages, durable concurrent admission, allowed endpoints,
body/response limits, rate/quota failures, ambiguous completion and no retry. Run
real local MyanLex integration against disposable PostgreSQL/Redis resources with
persisted keys/quotas, never production. CI must have a reproducible pinned test
fixture/build recipe or self-contained test artifact and must not need the sibling
checkout. No publication is required. Record any external download requirements.

After approval, provide exact startup/setup commands for both projects, test-only
resource provisioning and teardown, and observed test evidence. Do not execute
upstream migrations, seed routines or generate build files in the read-only reference.
Existing regression and Chromium/WebKit suites remain mandatory; Firefox remains
enabled and its launch failure reported honestly. Screen-reader, Safari/iOS,
low-memory physical devices, real-user and hosted-CI validation remain outstanding.

References checked before dependency selection: [Better Auth options](https://better-auth.com/docs/reference/options),
[email/password](https://better-auth.com/docs/authentication/email-password),
[cookies](https://better-auth.com/docs/concepts/cookies),
[Fastify server limits](https://fastify.dev/docs/latest/Reference/Server/).
Exact new package versions and adapters will be verified and pinned after approval.
