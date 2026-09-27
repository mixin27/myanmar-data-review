import { expect, it } from "vitest";
import { readCsv } from "../src/csv/dataset";

it("measures bounded synthetic import profiles without advertising a capacity guarantee", async () => {
  const profiles = [
    {
      name: "50,000 rows × 5 columns",
      text:
        "a,b,c,d,e\n" +
        Array.from(
          { length: 50_000 },
          (_, i) => `${String(i).padStart(7, "0")},text,value,001,😀`,
        ).join("\n"),
      rows: 50_000,
    },
    {
      name: "100 columns × 4,999 rows",
      text: Array.from({ length: 5000 }, () =>
        Array.from({ length: 100 }, () => "001").join(","),
      ).join("\n"),
      rows: 4999,
    },
    {
      name: "9.9 MB / long values",
      text:
        "value\n" +
        Array.from({ length: 104 }, () => "x".repeat(99999)).join("\n"),
      rows: 104,
    },
  ];
  for (const profile of profiles) {
    const file = new Blob([profile.text]);
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    const dataset = await readCsv(
      file,
      { delimiter: ",", hasHeader: true },
      "benchmark",
    );
    const ms = Math.round(performance.now() - start);
    const heapDeltaMb = Math.max(
      0,
      (process.memoryUsage().heapUsed - before) / 1024 / 1024,
    ).toFixed(1);
    expect(dataset.rowCount).toBe(profile.rows);
    expect(dataset.page(0).rows.length).toBeLessThanOrEqual(25);
    console.log(
      JSON.stringify({
        profile: profile.name,
        bytes: file.size,
        ms,
        heapDeltaMb,
        note: "Node heap delta, not peak browser memory",
      }),
    );
  }
});
