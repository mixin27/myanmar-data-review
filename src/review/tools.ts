import { matches, type Queue, type ReviewCell } from "./model";
import { finding } from "./presentation";

export interface ReviewFilters {
  query: string;
  column: string;
  finding: string;
  decision: string;
}
export const emptyFilters: ReviewFilters = {
  query: "",
  column: "",
  finding: "",
  decision: "",
};
export function filterCells(
  cells: readonly ReviewCell[],
  queue: Queue,
  filters: ReviewFilters,
) {
  const query = filters.query.toLowerCase();
  return cells.filter(
    (cell) =>
      matches(cell, queue) &&
      (!filters.column || cell.column === filters.column) &&
      (!filters.finding || finding(cell) === filters.finding) &&
      (!filters.decision || cell.decision === filters.decision) &&
      (!query ||
        cell.original.toLowerCase().includes(query) ||
        cell.proposal?.text.toLowerCase().includes(query)),
  );
}
// Highlight one changed range, preserving grapheme clusters; linear, not a linguistic transform.
export function changedRange(original: string, proposed: string) {
  const segmenter = new Intl.Segmenter("my", { granularity: "grapheme" });
  const split = (text: string) =>
    Array.from(segmenter.segment(text), (part) => part.segment);
  const before = split(original),
    after = split(proposed);
  let start = 0,
    end = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return {
    prefix: before.slice(0, start).join(""),
    removed: before.slice(start, before.length - end).join(""),
    added: after.slice(start, after.length - end).join(""),
    suffix: end ? before.slice(-end).join("") : "",
  };
}
