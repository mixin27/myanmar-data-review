# Release validation and operator guide

Run the complete checks with `pnpm check`, `pnpm test:browser` and
`pnpm verify:clean`. Install the pinned Playwright browsers first with
`pnpm exec playwright install chromium firefox webkit` (Linux CI adds
`--with-deps`). Browser tests run the same workflow in all three engines.
WebKit automation is not verification of the shipping Safari app or iOS devices.

## Recovery

| Situation                               | Recovery                                                                                | Data retained                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Import rejected                         | Correct the CSV encoding/layout or split an over-limit file, then reopen it             | Original file on disk is unchanged                               |
| Inspection stopped, timed out or failed | Review completed cells, then explicitly start a new review if needed                    | Originals and completed results; rerunning invalidates approvals |
| Export/backup preparation failed        | Retry explicitly; reduce the project if a resource limit was reached                    | In-memory review and previous device save                        |
| Save failed or storage is full          | Download a portable backup; free storage before explicitly saving again                 | Previous successful save remains intact                          |
| Another tab owns the project            | Close that project in the other tab, then reopen it here                                | Read-only viewing/export/backup remain available                 |
| Saved revision changed                  | Download a backup of current work, then reopen the saved project                        | Newer saved revision is not overwritten                          |
| Unsupported backup/database version     | Keep the backup and use a compatible app version; do not clear storage as a repair step | Unsupported records are not overwritten                          |
| Browser storage was cleared or evicted  | Open a previously downloaded backup                                                     | Device saves cannot be recovered without a backup                |

Keep a portable backup before clearing browser data or moving devices. Device
saves belong to the current browser profile and origin. Saving on localhost does
not transfer a project to a hosted installation. Opening a backup does not save
it or rerun inspection; save it explicitly if desired.

## Resource boundaries

Import guards: 10 MiB, 50,000 rows, 100 columns, 500,000 fields including headers,
and 100,000 UTF-16 code units per cell. Inspection allows 10,000 selected cells
and a bounded result budget. Backups and each export/report output have a 96 MiB
limit; project-file work times out after 30 seconds. These reject oversized work,
but are not promises of peak memory usage or completion on every device.

The synthetic import benchmark reports Node heap deltas, not peak browser memory.
Browser suites measure 50,000-row import and 10,000-cell review elapsed time.
`pnpm benchmark:browser` samples the Chromium test process tree every 100 ms.
This includes tooling and browser children, double-counts shared pages and can miss
peaks between samples. Low-memory devices and precise peak-memory profiling remain
release gates. Do not raise limits based only on desktop timings.

## Human validation still required

Use approved synthetic examples or operator-owned data; do not publish raw records.
Ask representative operators to complete these tasks without coaching:

1. Import a file, confirm its separator/header and choose columns.
2. Explain the difference between an unchanged value and an unresolved finding.
3. Inspect first, enable conversion, review and approve a proposal.
4. Propose a manual replacement, approve it separately and identify retained findings.
5. Export all rows and distinguish the report from the reviewed CSV.
6. Choose a spreadsheet escape mode and explain its changes to values.
7. Save, close, reopen and recover a portable backup.

Record task completion, misunderstandings and recovery attempts without collecting
cell text. Validate keyboard-only use and a real screen reader (VoiceOver and/or
NVDA), including dialog announcements, focus return, progress updates and Myanmar
text pronunciation. Automated focus checks cannot establish screen-reader usability
or linguistic correctness. Independent linguistic evaluation remains separate from
parity with the pinned MyanLex services.

## Evidence boundaries

Hosted CI requires an authorized push and has not run. No deployment, user study,
physical mobile-device test or production readiness claim is implied by local tests.
Dependency and browser versions are pinned by the lockfile/Playwright installation.
Configuration follows the official [Playwright browser guide](https://playwright.dev/docs/browsers);
keyboard checks follow its [keyboard API](https://playwright.dev/docs/api/class-keyboard).

## Current Firefox environment blocker

On macOS 27.0, the pinned Firefox 155 / Playwright revision 1543 still exits before
loading this app with `Could not find profile folder`. The symptom and OS match
[Playwright issue 42768](https://github.com/microsoft/playwright/issues/42768) and
[Mozilla bug 2062988](https://bugzilla.mozilla.org/show_bug.cgi?id=2062988), which
identify app-data/profile startup access problems on macOS. This is supporting
evidence, not proof of this machine's exact permission state. Moving only the
profile to `/private/tmp` did not fix the previous reproduction.

Do not disable Firefox, modify the browser binary or weaken macOS privacy settings
just to get passing tests. Run the unchanged suite on a supported Linux environment
or an upstream-fixed browser version once available and verified. Docker is installed
locally but its daemon was unavailable during this validation; no Linux run is claimed.
Hosted Ubuntu CI already includes Firefox but still needs an authorized push.

## Owner-only preview check (no testing team required)

Run `pnpm dev` and use a copy of your own CSV. Complete these steps:

1. Choose only the text columns you intend to inspect.
2. Inspect without conversion. A finding with no proposed change is allowed;
   uncertain encoding does not prove that the text is incorrect.
3. Enable Unicode conversion, start a new review and approve one eligible change.
4. Export and compare the changed value and an untouched identifier in another CSV
   viewer. Keep the original file; spreadsheet escaping intentionally changes values.
5. Download a backup, reload, open the backup and verify the approval is retained.

If something is confusing, record the button/step and what you expected. Screenshots
are optional; hide sensitive text before sharing. Owner observations are useful
feedback but do not count as independent testing or linguistic validation. Do not
claim screen-reader or physical-device coverage from automated viewport tests.
