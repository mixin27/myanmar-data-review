# Myanmar Data Review

Read PRODUCT_PLAN.md before changing scope. This private product is not licensed
for open-source distribution. Do not deploy, publish packages, commit, push, or
change GitHub settings without explicit authorization.

## Boundaries

- MyanLex at ../myanlex is a read-only reference. Do not modify it without approval.
- Read its AGENTS.md, relevant linguistic specifications, contracts, tests and
  notices before changing integration. Report necessary upstream changes.
- Reuse @myanlex/application through public exports; engine dependencies are
  @myanlex/core and @myanlex/types. Never copy linguistic algorithms.
- No private playground package, internal playground endpoints, SDK/API runtime,
  sibling-source imports, workspace links, or machine-specific dependencies.
- Consume the immutable archives in vendor/myanlex. Preserve source commit,
  checksums, build identity, MIT/Apache licenses and third-party notices.
- Artifact updates use scripts/package-myanlex.py in an isolated temporary build.
  Never overwrite a published artifact identity with different bytes. Review all
  checksums and run the isolated consumer test after an update.
- Runtime application imports belong only in the dedicated worker processing
  module. Main-thread code may import types only. Keep product policy independent
  of UI and do not recreate character classification or conversion algorithms.
- Local execution requires neither sign-in nor API availability. No fallback,
  automatic uploads, analytics, remote fonts, or automatic text persistence.
- Cancel synchronous work by terminating the worker. Preserve request/revision
  identity, enforce a timeout and ignore stale results. Never log entered text.
- Public MyanLex offsets are Unicode code points, not UTF-16 indexes. Every result
  with spans must retain the exact analyzed string.

## Scope and verification

Current milestone: scaffold, CI, package integration, dedicated local worker and
minimal verification screen. CSV workflows, review approvals, persistence,
authentication and API mode are later milestones.

Verify official docs before adding dependencies. Use pinned versions and lockfile.
Run pnpm check and pnpm test:browser; generate types before typechecking in a
fresh checkout. CI must work without the sibling repository or generated files.
Use automated tests, not computer-use tools. Record browser-specific omissions.
Fixtures require provenance and redistribution permission; parity is not proof
of linguistic accuracy. Keep original input immutable and uncertainty explicit.
