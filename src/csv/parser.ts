import { CSV_LIMITS, CsvError } from "./contracts";
import type { CsvLimits, CsvOptions } from "./contracts";

// Strict, incremental CSV transport parser. No text normalization, type coercion,
// trimming, skipped records or inferred repairs. State survives chunk boundaries.
export class CsvParser {
  private readonly records: string[][] = [];
  private row: string[] = [];
  private fieldParts: string[] = [];
  private fieldLength = 0;
  private state: "start" | "plain" | "quoted" | "closed" = "start";
  private rowStarted = false;
  private skipLf = false;
  private previousCr = false;
  private line = 1;
  private width: number | undefined;
  private cells = 0;
  private ended = false;

  constructor(
    private readonly options: CsvOptions,
    private readonly limits: CsvLimits = CSV_LIMITS,
  ) {}

  push(chunk: string): void {
    if (this.ended) throw new Error("Parser already finished");
    for (const character of chunk) {
      if (this.skipLf) {
        this.skipLf = false;
        if (character === "\n") {
          this.advanceLine(character);
          continue;
        }
      }
      if (this.state === "quoted") {
        if (character === '"') this.state = "closed";
        else this.append(character);
      } else if (this.state === "closed") {
        if (character === '"') {
          this.append('"');
          this.state = "quoted";
        } else if (character === this.options.delimiter) this.endField();
        else if (character === "\r" || character === "\n")
          this.endRecord(character);
        else
          this.fail(
            "invalid_quote",
            "A closing quote must be followed by a separator or a new line.",
          );
      } else if (character === '"') {
        if (this.state !== "start")
          this.fail(
            "invalid_quote",
            "A quote inside a value must be enclosed in double quotes.",
          );
        this.state = "quoted";
        this.rowStarted = true;
      } else if (character === this.options.delimiter) {
        this.rowStarted = true;
        this.endField();
      } else if (character === "\r" || character === "\n")
        this.endRecord(character);
      else {
        this.append(character);
        this.state = "plain";
        this.rowStarted = true;
      }
      this.advanceLine(character);
    }
  }

  finish(): readonly (readonly string[])[] {
    if (this.ended) throw new Error("Parser already finished");
    if (this.state === "quoted")
      this.fail("unclosed_quote", "A quoted value has no closing quote.");
    if (this.rowStarted || this.row.length || this.state !== "start")
      this.endRecord("");
    this.ended = true;
    if (this.records.length <= (this.options.hasHeader ? 1 : 0)) {
      this.fail(
        "no_records",
        this.options.hasHeader
          ? "This file has no data rows. If it has no headings, turn off “First row contains column names”."
          : "This file has no data rows.",
      );
    }
    return Object.freeze(this.records.map((row) => Object.freeze(row)));
  }

  private append(value: string) {
    if (this.fieldLength + value.length > this.limits.maxCellCodeUnits)
      this.fail(
        "cell_limit",
        "One value is too long to open. Shorten that value or split the file.",
      );
    this.fieldParts.push(value);
    this.fieldLength += value.length;
  }
  private endField() {
    if (this.row.length >= this.limits.maxColumns)
      this.fail(
        "column_limit",
        `This file has more than ${this.limits.maxColumns} columns. Choose a smaller set of columns in the source file.`,
      );
    this.row.push(this.fieldParts.join(""));
    this.fieldParts = [];
    this.fieldLength = 0;
    this.state = "start";
  }
  private endRecord(separator: string) {
    this.endField();
    this.width ??= this.row.length;
    if (this.row.length !== this.width)
      this.fail(
        "uneven_rows",
        `This record has ${this.row.length} values; the first record has ${this.width}. Check the separator or fix this record in the source file.`,
      );
    const maxRecords = this.limits.maxRows + (this.options.hasHeader ? 1 : 0);
    if (this.records.length >= maxRecords)
      this.fail(
        "row_limit",
        `This file has more than ${this.limits.maxRows.toLocaleString("en-US")} data rows. Split it into smaller files.`,
      );
    this.cells += this.row.length;
    if (this.cells > this.limits.maxCells)
      this.fail(
        "cell_count_limit",
        "This file contains too many values to open at once. Split it into smaller files.",
      );
    this.records.push(this.row);
    this.row = [];
    this.rowStarted = false;
    this.skipLf = separator === "\r";
  }
  private advanceLine(character: string) {
    if (character === "\r" || (character === "\n" && !this.previousCr))
      this.line++;
    this.previousCr = character === "\r";
  }
  private fail(code: string, message: string): never {
    throw new CsvError({
      code,
      message,
      record: this.records.length + 1,
      line: this.line,
      field: this.row.length + 1,
    });
  }
}
