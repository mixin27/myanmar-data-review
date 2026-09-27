import { CSV_LIMITS, CsvError } from "./contracts";
import type {
  CsvColumn,
  CsvLimits,
  CsvOptions,
  CsvPage,
  CsvRow,
  CsvSummary,
} from "./contracts";
import { CsvParser } from "./parser";

export class CsvDataset {
  readonly columns: readonly CsvColumn[];
  readonly rowCount: number;
  constructor(
    readonly id: string,
    readonly name: string,
    readonly bytes: number,
    readonly fingerprint: string,
    readonly options: CsvOptions,
    private readonly records: readonly (readonly string[])[],
  ) {
    this.options = Object.freeze({ ...options });
    this.columns = Object.freeze(
      records[0]!.map((header, index) =>
        Object.freeze({
          id: `${id}:c:${index}`,
          index,
          header: options.hasHeader ? header : null,
        }),
      ),
    );
    this.rowCount = records.length - (options.hasHeader ? 1 : 0);
  }
  page(offset: number, count = 25): CsvPage {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= this.rowCount ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 50
    ) {
      throw new CsvError({
        code: "invalid_page",
        message: "This page is not available. Return to the first page.",
      });
    }
    const skip = this.options.hasHeader ? 1 : 0;
    const rows: CsvRow[] = this.records
      .slice(offset + skip, offset + skip + count)
      .map((values, index) => {
        const record = offset + skip + index;
        return Object.freeze({
          id: `${this.id}:r:${record}`,
          sourceRecord: record + 1,
          values,
        });
      });
    return Object.freeze({ offset, rows: Object.freeze(rows) });
  }
  summary(): CsvSummary {
    return Object.freeze({
      id: this.id,
      name: this.name,
      bytes: this.bytes,
      fingerprint: this.fingerprint,
      options: this.options,
      rowCount: this.rowCount,
      columns: this.columns,
      preview: this.page(0, 5),
    });
  }
}

export async function readCsv(
  file: Blob & { readonly name?: string },
  options: CsvOptions,
  id: string,
  progress: (percent: number) => void = () => {},
  limits: CsvLimits = CSV_LIMITS,
): Promise<CsvDataset> {
  if (file.size > limits.maxFileBytes)
    throw new CsvError({
      code: "file_limit",
      message: `Choose a CSV smaller than ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB.`,
    });
  if (
    ![",", ";", "\t"].includes(options.delimiter) ||
    typeof options.hasHeader !== "boolean"
  )
    throw new CsvError({
      code: "invalid_options",
      message: "Choose a separator and check the column-name setting.",
    });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parser = new CsvParser(options, limits);
  let bytes = 0;
  let lastPercent = -1;
  while (bytes < file.size) {
    const chunk = await file.slice(bytes, bytes + 64 * 1024).arrayBuffer();
    let text: string;
    try {
      text = decoder.decode(chunk, { stream: true });
    } catch {
      throw new CsvError({
        code: "invalid_utf8",
        message:
          "This file is not valid UTF-8. Save it as “CSV UTF-8” in the source app, then choose it again.",
      });
    }
    parser.push(text);
    bytes += chunk.byteLength;
    const percent = Math.floor((bytes / file.size) * 95);
    if (percent !== lastPercent) {
      lastPercent = percent;
      progress(percent);
    }
  }
  try {
    parser.push(decoder.decode());
  } catch (error) {
    if (error instanceof CsvError) throw error;
    throw new CsvError({
      code: "invalid_utf8",
      message:
        "This file ends with incomplete UTF-8 text. Save a new CSV UTF-8 copy, then choose it again.",
    });
  }
  const records = parser.finish();
  // Hash only after all import resource checks have succeeded; source File remains
  // immutable and separate from parsed values. No replacement decoding or trimming.
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const fingerprint = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  progress(100);
  return new CsvDataset(
    id,
    file.name ?? "data.csv",
    file.size,
    fingerprint,
    options,
    records,
  );
}
