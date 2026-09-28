import type { CsvOptions } from "../csv/contracts";
import type { ReviewCell, Settings } from "../review/model";
export interface ReviewCheckpoint {
  cells: readonly ReviewCell[];
  settings: Settings;
  engineIdentity: string;
  inspected: boolean;
}
export interface ProjectSnapshot {
  format: "myanmar-data-review";
  version: 1;
  datasetId: string;
  sourceName: string;
  sourceBase64: string;
  fingerprint: string;
  options: CsvOptions;
  selected: readonly string[];
  review: ReviewCheckpoint | null;
}
export interface ProjectInput {
  file: File;
  datasetId: string;
  fingerprint: string;
  options: CsvOptions;
  selected: readonly string[];
  review: ReviewCheckpoint | null;
}
export interface ExportOptions {
  spreadsheetSafe: boolean;
  bom: boolean;
  includeText: boolean;
  acknowledge: boolean;
}
export type ProjectJob =
  | { type: "pack"; input: ProjectInput }
  | { type: "restore"; backup: Blob }
  | { type: "export"; input: ProjectInput; options: ExportOptions };
export interface ExportSummary {
  rows: number;
  selectedCells: number;
  changed: number;
  unresolved: number;
  failed: number;
  incomplete: number;
  unreviewed: number;
  escaped: { row: number; column: number; header: boolean }[];
}
export type ProjectResult =
  | { type: "packed"; snapshot: ProjectSnapshot; backup: Blob }
  | { type: "restored"; snapshot: ProjectSnapshot; file: File }
  | { type: "exported"; csv: Blob; report: Blob; summary: ExportSummary };
export const BACKUP_LIMIT = 96 * 1024 * 1024;
