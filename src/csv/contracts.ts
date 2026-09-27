export type Delimiter = "," | ";" | "\t";
export interface CsvOptions {
  readonly delimiter: Delimiter;
  readonly hasHeader: boolean;
}
export const CSV_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 100,
  maxCells: 500_000,
  maxCellCodeUnits: 100_000,
} as const;
export type CsvLimits = { readonly [K in keyof typeof CSV_LIMITS]: number };
export interface CsvColumn {
  readonly id: string;
  readonly index: number;
  readonly header: string | null;
}
export interface CsvRow {
  readonly id: string;
  readonly sourceRecord: number;
  readonly values: readonly string[];
}
export interface CsvPage {
  readonly offset: number;
  readonly rows: readonly CsvRow[];
}
export interface CsvSummary {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: string;
  readonly options: CsvOptions;
  readonly rowCount: number;
  readonly columns: readonly CsvColumn[];
  readonly preview: CsvPage;
}
export interface CsvProblem {
  readonly code: string;
  readonly message: string;
  readonly record?: number;
  readonly line?: number;
  readonly field?: number;
}
export type CsvRequest = { readonly id: number; readonly session: string } & (
  | { readonly type: "open"; readonly file: File; readonly options: CsvOptions }
  | { readonly type: "page"; readonly offset: number; readonly count: number }
);
export type CsvResponse = { readonly id: number; readonly session: string } & (
  | { readonly type: "progress"; readonly percent: number }
  | { readonly type: "ready"; readonly summary: CsvSummary }
  | { readonly type: "page"; readonly page: CsvPage }
  | { readonly type: "error"; readonly problem: CsvProblem }
);
export class CsvError extends Error {
  constructor(readonly problem: CsvProblem) {
    super(problem.message);
    this.name = "CsvError";
  }
}
export function columnLabel(column: CsvColumn): string {
  return column.header?.trim() ? column.header : `Column ${column.index + 1}`;
}
