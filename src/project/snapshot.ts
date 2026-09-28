import { CSV_LIMITS, columnLabel } from "../csv/contracts";
import { readCsv } from "../csv/dataset";
import type { CsvDataset } from "../csv/dataset";
import { REVIEW_LIMITS, unresolved } from "../review/model";
import type { ReviewCell } from "../review/model";
import { BACKUP_LIMIT } from "./contracts";
import type { ProjectInput, ProjectSnapshot } from "./contracts";

function check(
  value: unknown,
  message = "This backup is incomplete or inconsistent.",
): asserts value {
  if (!value) throw new Error(message);
}
function object(value: unknown): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 200000): asserts value is string {
  check(
    typeof value === "string" &&
      value.length <= max &&
      !Array.from(value).some((c) => /^[\uD800-\uDFFF]$/u.test(c)),
  );
}
function integer(value: unknown, min = 0): asserts value is number {
  check(Number.isSafeInteger(value) && Number(value) >= min);
}
function oneOf(value: unknown, options: readonly unknown[]) {
  check(options.includes(value));
}
function bool(value: unknown) {
  check(typeof value === "boolean");
}
function array(value: unknown, max: number): asserts value is unknown[] {
  check(Array.isArray(value) && value.length <= max);
}
function engine(value: unknown) {
  const e = object(value);
  check(e.mode === "local");
  for (const key of ["upstreamCommit", "packageVersion", "compiler", "buildId"])
    text(e[key], 200);
  check(
    /^[a-f0-9]{40}$/.test(String(e.upstreamCommit)) &&
      /^[a-f0-9]{64}$/.test(String(e.buildId)),
  );
  array(e.artifacts, 3);
  check(e.artifacts.length === 3);
  for (const entry of e.artifacts) {
    const artifact = object(entry);
    text(artifact.name, 100);
    text(artifact.sha256, 64);
    check(/^[a-f0-9]{64}$/.test(artifact.sha256));
  }
}
function span(value: unknown, points: string[]) {
  const s = object(value);
  integer(s.start);
  integer(s.end);
  check(s.start < s.end && s.end <= points.length);
  return s;
}
function validation(value: unknown, expected: string) {
  if (value === null) return;
  const v = object(value);
  check(v.input === expected && v.profile === "burmese-orthography-v1");
  bool(v.valid);
  array(v.diagnostics, 200000);
  const points = Array.from(expected);
  for (const diagnostic of v.diagnostics) {
    const d = span(diagnostic, points);
    oneOf(d.code, [
      "component_order",
      "dangling_virama",
      "duplicate_component",
      "invalid_syllable_start",
      "orphan_mark",
      "unsupported_myanmar",
      "unsupported_stack_target",
    ]);
    check(d.severity === "error");
    text(d.message, 1000);
  }
  check(v.valid === (v.diagnostics.length === 0));
}
function result(
  value: unknown,
  original: string,
  identity: string,
  settings: { convertToUnicode: boolean; normalizeNfc: boolean },
) {
  const r = object(value);
  check(r.original === original);
  text(r.output);
  check(r.changed === (r.output !== original));
  engine(r.engine);
  check(JSON.stringify(r.engine) === identity);
  const d = object(r.detection);
  check(d.input === original && d.profile === "zawgyi-unicode-v1");
  oneOf(d.encoding, ["unicode", "zawgyi", "mixed", "unknown", "non_myanmar"]);
  check(
    d.confidence === null ||
      (typeof d.confidence === "number" &&
        d.confidence >= 0 &&
        d.confidence <= 1),
  );
  array(d.segments, 100000);
  const points = Array.from(original);
  let end = 0;
  for (const item of d.segments) {
    const s = span(item, points);
    check(Number(s.start) >= end);
    end = Number(s.end);
    check(s.text === points.slice(Number(s.start), end).join(""));
    oneOf(s.encoding, ["unicode", "zawgyi", "unknown"]);
    check(
      s.zawgyiProbability === null ||
        (typeof s.zawgyiProbability === "number" &&
          s.zawgyiProbability >= 0 &&
          s.zawgyiProbability <= 1),
    );
  }
  oneOf(r.unresolvedReason, [
    null,
    "encoding_mixed",
    "encoding_uncertain",
    "conversion_required",
  ]);
  const expectedReason =
    d.encoding === "mixed"
      ? "encoding_mixed"
      : d.encoding === "unknown" ||
          d.segments.some((s) => object(s).encoding === "unknown")
        ? "encoding_uncertain"
        : d.encoding === "zawgyi" && !settings.convertToUnicode
          ? "conversion_required"
          : null;
  check(r.unresolvedReason === expectedReason);
  let output = original;
  if (r.conversion !== null) {
    const c = object(r.conversion);
    check(
      settings.convertToUnicode && !expectedReason && d.encoding === "zawgyi",
    );
    check(
      c.input === output &&
        c.from === "zawgyi" &&
        c.to === "unicode" &&
        c.profile === "cldr-zawgyi-v1",
    );
    text(c.output);
    check(c.changed === (c.output !== output));
    output = c.output;
  } else check(d.encoding !== "zawgyi" || !!expectedReason);
  if (r.normalization !== null) {
    const n = object(r.normalization);
    check(
      settings.normalizeNfc &&
        !expectedReason &&
        n.input === output &&
        n.profile === "unicode-nfc",
    );
    text(n.output);
    check(n.changed === (n.output !== output));
    output = n.output;
  } else check(!settings.normalizeNfc || !!expectedReason);
  check(output === r.output);
  check(
    (r.originalValidation !== null) ===
      (d.encoding === "unicode" &&
        !d.segments.some((s) => object(s).encoding === "unknown")),
  );
  check(
    (r.validation !== null) ===
      (!expectedReason && d.encoding !== "non_myanmar"),
  );
  validation(r.originalValidation, original);
  validation(r.validation, output);
  if (expectedReason)
    check(
      r.validation === null &&
        r.conversion === null &&
        r.normalization === null,
    );
}
// Depth is bounded before JSON.parse, including arrays. Strings and escapes are skipped.
export function parseBackup(textValue: string): unknown {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const char of textValue) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      depth++;
      check(depth <= 20, "This backup is nested too deeply.");
    } else if (char === "}" || char === "]") depth--;
  }
  try {
    return JSON.parse(textValue);
  } catch (cause) {
    throw new Error("This is not a valid project backup.", { cause });
  }
}
function boundedTree(value: unknown, depth = 0, budget = { nodes: 0 }) {
  check(depth <= 20 && ++budget.nodes <= 2_000_000);
  if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      check(!["__proto__", "prototype", "constructor"].includes(key));
      boundedTree(child, depth + 1, budget);
    }
}
export function sourceFile(snapshot: ProjectSnapshot): File {
  const bytes = Uint8Array.from(atob(snapshot.sourceBase64), (c) =>
    c.charCodeAt(0),
  );
  return new File([bytes], snapshot.sourceName, { type: "text/csv" });
}
export async function validateSnapshot(
  value: unknown,
): Promise<{ snapshot: ProjectSnapshot; dataset: CsvDataset; file: File }> {
  boundedTree(value);
  const p = object(value);
  check(
    p.format === "myanmar-data-review" && p.version === 1,
    "This backup version is not supported.",
  );
  text(p.datasetId, 100);
  check(/^[a-zA-Z0-9-]+$/.test(p.datasetId));
  text(p.sourceName, 255);
  text(p.fingerprint, 64);
  check(/^[a-f0-9]{64}$/.test(p.fingerprint));
  check(
    typeof p.sourceBase64 === "string" &&
      p.sourceBase64.length <= Math.ceil(CSV_LIMITS.maxFileBytes / 3) * 4 &&
      p.sourceBase64.length % 4 === 0 &&
      !/[^A-Za-z0-9+/=]/.test(p.sourceBase64),
  );
  const options = object(p.options);
  oneOf(options.delimiter, [",", ";", "\t"]);
  bool(options.hasHeader);
  array(p.selected, 100);
  check(
    p.selected.length > 0 && new Set(p.selected).size === p.selected.length,
  );
  for (const id of p.selected) text(id, 150);
  const snapshot = value as ProjectSnapshot;
  const file = sourceFile(snapshot);
  const dataset = await readCsv(file, snapshot.options, snapshot.datasetId);
  check(
    dataset.fingerprint === p.fingerprint,
    "The original file does not match this backup’s fingerprint.",
  );
  const columns = dataset.columns.filter((c) =>
    snapshot.selected.includes(c.id),
  );
  check(columns.length === p.selected.length);
  if (p.review !== null) {
    const review = object(p.review);
    const settings = object(review.settings);
    bool(settings.convertToUnicode);
    bool(settings.normalizeNfc);
    bool(review.inspected);
    text(review.engineIdentity, 5000);
    if (review.engineIdentity) engine(parseBackup(review.engineIdentity));
    array(review.cells, REVIEW_LIMITS.cells);
    check(review.cells.length === dataset.rowCount * columns.length);
    let index = 0;
    for (let offset = 0; offset < dataset.rowCount; offset += 50)
      for (const [relative, row] of dataset.page(offset, 50).rows.entries())
        for (const column of columns) {
          const c = object(review.cells[index++]);
          check(
            c.id === `${row.id}/${column.id}` &&
              c.row === offset + relative + 1 &&
              c.column ===
                `${columnLabel(column)} · Column ${column.index + 1}` &&
              c.original === row.values[column.index],
          );
          oneOf(c.processing, [
            "not_run",
            "running",
            "succeeded",
            "failed",
            "cancelled",
          ]);
          oneOf(c.decision, ["unreviewed", "approved", "rejected"]);
          if (c.error !== null) text(c.error, 2000);
          if (c.result !== null)
            result(
              c.result,
              String(c.original),
              review.engineIdentity,
              settings as { convertToUnicode: boolean; normalizeNfc: boolean },
            );
          check((c.processing === "succeeded") === (c.result !== null));
          if (c.proposal !== null) {
            const proposal = object(c.proposal);
            text(proposal.text, 100000);
            integer(proposal.revision, 1);
            oneOf(proposal.provenance, ["engine", "manual"]);
            check(proposal.text !== c.original);
            if (proposal.provenance === "engine")
              check(
                c.result &&
                  object(c.result).changed === true &&
                  proposal.text === object(c.result).output,
              );
          }
          if (c.decision === "approved") {
            check(
              c.proposal && c.approvalRevision === object(c.proposal).revision,
            );
            if (object(c.proposal).provenance === "engine")
              check(
                c.processing === "succeeded" &&
                  !unresolved(c as unknown as ReviewCell),
              );
          } else check(c.approvalRevision === null);
          if (["not_run", "running"].includes(String(c.processing)))
            check(c.proposal === null && c.decision === "unreviewed");
        }
  }
  return { snapshot, dataset, file };
}
export async function pack(input: ProjectInput) {
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  const snapshot: ProjectSnapshot = {
    format: "myanmar-data-review",
    version: 1,
    datasetId: input.datasetId,
    sourceName: input.file.name,
    sourceBase64: btoa(binary),
    fingerprint: input.fingerprint,
    options: input.options,
    selected: input.selected,
    review: input.review,
  };
  const backup = new Blob([JSON.stringify(snapshot)], {
    type: "application/json",
  });
  check(
    backup.size <= BACKUP_LIMIT,
    "This project exceeds the 96 MB backup limit. Reduce the review size.",
  );
  const { dataset } = await validateSnapshot(snapshot);
  return { snapshot, backup, dataset };
}
