# Reviewing files efficiently

Use **Search text** to find text in originals or proposed values. Combine it with
column, finding, decision and review-queue filters. Search does not normalize or
convert text. **Clear filters** shows all selected cells. **Go to row** clears the
filters and opens the first selected cell in that source row (headers are not data
rows). Exports always include every source row and column.

Inside a cell, **Previous cell / Next cell** move through the filtered results.
**Alt+P / Alt+N** do the same, except while typing in an input. Navigating away from
an unproposed replacement asks before discarding it. Highlighting shows one changed
range with whole grapheme clusters; unchanged characters between edits can also be
highlighted. It is a visual comparison, not another language check.

**Undo last review action** restores a proposal or decision. A bulk approval or
matching-value decision is one action. Undo retains up to 50 actions within a
bounded memory allowance; an unusually large action can exhaust that allowance.
It is available only in this session, clears on a new inspection/cancellation,
and is not included in saves or backups. Save explicitly after undoing if you want
the saved project to reflect the restored decision. Downloaded files are unchanged.

**Review matching values** offers an explicit confirmation for exact matching
originals in the same column, including matches outside your current filters.
Automatic approval also requires identical eligible proposed values. Unresolved
and manual proposals cannot be approved this way. Keeping originals preserves their
findings. Manual replacements still require individual approval.

Use **Language / ဘာသာစကား** for English or Myanmar controls and explanations.
Source text, column names and filenames remain untouched. The language choice is
not saved and switching languages does not run processing. Some exceptional errors
from lower-level file/storage operations may still appear in English. Translation
quality needs independent native-speaker review before release.
