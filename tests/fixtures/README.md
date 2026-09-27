# Fixture provenance

`detection-v1.json` is an unchanged copy of MyanLex
`corpus/encoding/detection-v1.json` at commit
`51d8d6353d7f08fe389e046fac4c5953a70de33b`. It records its sources,
derivation and Apache-2.0 redistribution license in the file. The full license
and Google/MyanLex notices are in `public/licenses/` and ship with the app.

The `မြန်မာ` / `ျမန္မာ` consumer examples come from that commit's MIT-licensed
`packages/application/test/myanlex-application.test.ts`. They are integration
regressions, not independently validated linguistic expectations.

Transport inputs (ASCII, emoji, malformed surrogate, repeated characters,
HTML-looking strings and combining Latin accents) are project-authored synthetic
cases. Their test use is permitted with this private project's source. Tests
compare linguistic results to the pinned public application services; no new
linguistic ground truth is asserted.

Milestone-two CSV fixtures are generated in tests. Their values (IDs, placeholder
customer fields, quotes, line breaks, emoji, markup and formula-like strings) are
project-authored transport examples, with no claimed linguistic expected results.
Large datasets are generated at runtime. Supplied user CSVs are opt-in local test
inputs only and are not copied into this repository or screenshots.
