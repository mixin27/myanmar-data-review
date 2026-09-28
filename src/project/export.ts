import type { CsvDataset } from "../csv/dataset";
import { selectedValue, unresolved } from "../review/model";
import type {
  ProjectSnapshot,
  ExportOptions,
  ExportSummary,
} from "./contracts";
import { BACKUP_LIMIT } from "./contracts";

export function spreadsheetRisk(value: string): boolean {
  return /^[\t\r\n]/.test(value) || /^[=+\-@＝＋－＠]/u.test(value.trimStart());
}
export function summarize(
  snapshot: ProjectSnapshot,
  rows: number,
): ExportSummary {
  const cells = snapshot.review?.cells ?? [];
  return {
    rows,
    selectedCells: rows * snapshot.selected.length,
    changed: cells.filter((c) => selectedValue(c) !== c.original).length,
    unresolved: cells.filter(unresolved).length,
    failed: cells.filter((c) => c.processing === "failed").length,
    incomplete: snapshot.review
      ? cells.filter((c) =>
          ["not_run", "running", "cancelled"].includes(c.processing),
        ).length
      : rows * snapshot.selected.length,
    unreviewed: snapshot.review
      ? cells.filter((c) => c.decision === "unreviewed").length
      : rows * snapshot.selected.length,
    escaped: [],
  };
}
export function exportProject(
  snapshot: ProjectSnapshot,
  dataset: CsvDataset,
  options: ExportOptions,
) {
  const summary = summarize(snapshot, dataset.rowCount);
  if (
    (summary.unresolved ||
      summary.failed ||
      summary.incomplete ||
      summary.unreviewed) &&
    !options.acknowledge
  )
    throw new Error(
      "Acknowledge the remaining findings and unreviewed cells before exporting.",
    );
  const cells = new Map(snapshot.review?.cells.map((c) => [c.id, c]) ?? []);
  const applied: {
    cellId: string;
    proposalRevision: number;
    provenance: string;
    original?: string;
    value?: string;
  }[] = [];
  const parts: string[] = [];
  let size = options.bom ? 3 : 0;
  const encoder = new TextEncoder();
  const row = (
    values: readonly string[],
    rowNumber: number,
    header: boolean,
  ) => {
    const output =
      values
        .map((value, column) => {
          if (options.spreadsheetSafe && spreadsheetRisk(value)) {
            summary.escaped.push({
              row: rowNumber,
              column: column + 1,
              header,
            });
            value = "'" + value;
          }
          return '"' + value.replaceAll('"', '""') + '"';
        })
        .join(snapshot.options.delimiter) + "\r\n";
    size += encoder.encode(output).length;
    if (size > BACKUP_LIMIT)
      throw new Error(
        "The export exceeds 96 MB. Export a smaller source file.",
      );
    parts.push(output);
  };
  if (snapshot.options.hasHeader)
    row(
      dataset.columns.map((c) => c.header!),
      0,
      true,
    );
  for (let offset = 0; offset < dataset.rowCount; offset += 50)
    for (const [relative, source] of dataset.page(offset, 50).rows.entries()) {
      row(
        source.values.map((original, columnIndex) => {
          const cell = cells.get(
            `${source.id}/${dataset.columns[columnIndex]!.id}`,
          );
          if (!cell || selectedValue(cell) === original) return original;
          applied.push({
            cellId: cell.id,
            proposalRevision: cell.proposal!.revision,
            provenance: cell.proposal!.provenance,
            ...(options.includeText
              ? { original, value: cell.proposal!.text }
              : {}),
          });
          return cell.proposal!.text;
        }),
        offset + relative + 1,
        false,
      );
    }
  const report = {
    format: "myanmar-data-review-report",
    version: 1,
    createdAt: new Date().toISOString(),
    source: {
      fingerprint: snapshot.fingerprint,
      rows: dataset.rowCount,
      columns: dataset.columns.length,
    },
    selectedColumns: snapshot.selected,
    engine: snapshot.review?.engineIdentity
      ? (JSON.parse(snapshot.review.engineIdentity) as unknown)
      : null,
    settings: snapshot.review?.settings ?? null,
    stages: [
      "inspect original",
      "optional guarded Unicode conversion",
      "optional NFC",
      "review and approval",
      "optional spreadsheet escaping",
    ],
    export: {
      ...options,
      delimiter: snapshot.options.delimiter,
      header: snapshot.options.hasHeader,
      recordSeparator: "CRLF",
      allRows: true,
      spreadsheetPolicy: options.spreadsheetSafe
        ? "apostrophe-prefix-v1"
        : null,
    },
    summary,
    applied,
    findings: (snapshot.review?.cells ?? [])
      .filter((c) => unresolved(c) || c.processing !== "succeeded")
      .map((c) => ({
        cellId: c.id,
        processing: c.processing,
        decision: c.decision,
        unresolvedReason: c.result?.unresolvedReason ?? null,
        structuralFindings:
          c.result?.validation?.diagnostics.map((d) => ({
            code: d.code,
            start: d.start,
            end: d.end,
            analyzed: "automatic-output",
          })) ?? [],
      })),
    notice:
      "User-controlled review record. Not a tamper-proof audit or independent linguistic validation. Approved manual replacements retain original findings. Spreadsheet escaping changes field values; spreadsheet behavior varies and re-saving may remove protection.",
  };
  const reportBlob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
  if (reportBlob.size > BACKUP_LIMIT)
    throw new Error(
      "This report exceeds 96 MB. Omit cell text or reduce the review size.",
    );
  return {
    csv: new Blob([...(options.bom ? ["\ufeff"] : []), ...parts], {
      type: "text/csv;charset=utf-8",
    }),
    report: reportBlob,
    summary,
  };
}
