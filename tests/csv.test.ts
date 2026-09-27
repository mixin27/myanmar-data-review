import { describe, expect, it } from "vitest";
import { CsvParser } from "../src/csv/parser";
import { CsvDataset, readCsv } from "../src/csv/dataset";
import { CSV_LIMITS, CsvError } from "../src/csv/contracts";
import type { CsvLimits, CsvOptions, Delimiter } from "../src/csv/contracts";

const noHeader: CsvOptions = { delimiter: ",", hasHeader: false };
function parse(
  text: string,
  options = noHeader,
  chunkSize = 3,
  limits: CsvLimits = CSV_LIMITS,
) {
  const parser = new CsvParser(options, limits);
  for (let at = 0; at < text.length; at += chunkSize)
    parser.push(text.slice(at, at + chunkSize));
  return parser.finish();
}
// Synthetic transport serialization for round-trip properties, not a product exporter.
function encode(rows: readonly (readonly string[])[], delimiter: Delimiter) {
  return rows
    .map((row) =>
      row
        .map((value) => '"' + value.replaceAll('"', '""') + '"')
        .join(delimiter),
    )
    .join("\r\n");
}
describe("strict lossless CSV import", () => {
  it("preserves strings, empty fields, quoting and embedded line endings across every boundary", () => {
    const rows = [
      ["0012", " ", "", "၅၂၀", "hello 😀"],
      [
        "a,b",
        'a"b',
        "line\r\nnext\nlast\r",
        "=SUM(A1)",
        "<script>alert(1)</script>",
      ],
    ];
    const text = encode(rows, ",");
    for (let width = 1; width < text.length; width++)
      expect(parse(text, noHeader, width)).toEqual(rows);
  });
  it.each([",", ";", "\t"] as const)(
    "round-trips generated field values with %j separators",
    (delimiter) => {
      let seed = 7;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
      };
      const parts = [
        "00",
        " ",
        "😀",
        "မြန်မာ",
        '"',
        ",",
        ";",
        "\t",
        "\r",
        "\n",
        "\u202e",
        "=1+1",
        "",
      ];
      for (let run = 0; run < 100; run++) {
        const columns = 1 + (random() % 8);
        const rows = Array.from({ length: 1 + (random() % 15) }, () =>
          Array.from({ length: columns }, () =>
            Array.from(
              { length: random() % 8 },
              () => parts[random() % parts.length],
            ).join(""),
          ),
        );
        expect(
          parse(
            encode(rows, delimiter),
            { delimiter, hasHeader: false },
            1 + (random() % 19),
          ),
        ).toEqual(rows);
      }
    },
  );
  it("preserves blank records but does not invent a row after the terminal separator", () => {
    expect(parse("a\r\n\r\nb\r\n")).toEqual([["a"], [""], ["b"]]);
    expect(parse("\n", noHeader)).toEqual([[""]]);
    expect(() => parse("a,b\n\n")).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({ code: "uneven_rows", record: 2 }),
      }),
    );
  });
  it.each(['a"b,c', '"a"oops,b', '"unfinished', '"a" ,b'])(
    "rejects malformed quoting: %s",
    (text) => {
      expect(() => parse(text)).toThrow(CsvError);
    },
  );
  it("reports logical record and physical line after embedded newlines", () => {
    expect(() => parse('a,b\n"one\ntwo",x\nmissing')).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          code: "uneven_rows",
          record: 3,
          line: 4,
        }),
      }),
    );
  });
  it("rejects empty and header-only inputs", () => {
    expect(() => parse("")).toThrow(CsvError);
    expect(() => parse("name,id\n", { ...noHeader, hasHeader: true })).toThrow(
      CsvError,
    );
  });
  it("bounds every dimension without returning partial rows", async () => {
    expect(() =>
      parse("a,b,c", noHeader, 2, { ...CSV_LIMITS, maxColumns: 2 }),
    ).toThrow(CsvError);
    expect(() =>
      parse("abc", noHeader, 2, { ...CSV_LIMITS, maxCellCodeUnits: 2 }),
    ).toThrow(CsvError);
    expect(() =>
      parse("a\nb", noHeader, 2, { ...CSV_LIMITS, maxRows: 1 }),
    ).toThrow(CsvError);
    expect(() =>
      parse("a,b\nc,d", noHeader, 2, { ...CSV_LIMITS, maxCells: 3 }),
    ).toThrow(CsvError);
    await expect(
      readCsv(new Blob(["abc"]), noHeader, "id", undefined, {
        ...CSV_LIMITS,
        maxFileBytes: 2,
      }),
    ).rejects.toMatchObject({ problem: { code: "file_limit" } });
  });
  it("strictly decodes UTF-8 with optional BOM and keeps source bytes intact", async () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('id,name\r\n001,"မြန်မာ"\r\n'),
    ]);
    const blob = new Blob([bytes]);
    const dataset = await readCsv(
      blob,
      { ...noHeader, hasHeader: true },
      "source",
    );
    expect(dataset.page(0).rows[0]!.values).toEqual(["001", "မြန်မာ"]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    expect(dataset.fingerprint).toBe(
      Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    );
    await expect(
      readCsv(new Blob([new Uint8Array([0xc3, 0x28])]), noHeader, "bad"),
    ).rejects.toMatchObject({ problem: { code: "invalid_utf8" } });
    await expect(
      readCsv(new Blob([new Uint8Array([0xe1, 0x80])]), noHeader, "bad"),
    ).rejects.toMatchObject({ problem: { code: "invalid_utf8" } });
  });
  it("decodes characters spanning byte chunks and retains intentional U+FEFF inside a field", async () => {
    const text = "x".repeat(65535) + "😀\ufeff";
    const result = await readCsv(new Blob([text]), noHeader, "boundary");
    expect(result.page(0).rows[0]!.values).toEqual([text]);
  });
  it("uses stable positional IDs for duplicate/empty headers and original record positions", () => {
    const rows = parse("name,,name\n001,002,003\n004,005,006");
    const dataset = new CsvDataset(
      "file",
      "test.csv",
      40,
      "hash",
      { ...noHeader, hasHeader: true },
      rows,
    );
    expect(dataset.columns.map((c) => c.header)).toEqual(["name", "", "name"]);
    expect(dataset.columns.map((c) => c.id)).toEqual([
      "file:c:0",
      "file:c:1",
      "file:c:2",
    ]);
    expect(dataset.page(1).rows[0]!.id).toBe("file:r:2");
    expect(dataset.page(0).rows[1]!.id).toBe("file:r:2");
    expect(() => ((rows[1] as string[])[0] = "changed")).toThrow();
    expect(() => dataset.page(-1)).toThrow(CsvError);
    expect(() => dataset.page(0, 10000)).toThrow(CsvError);
  });
});
