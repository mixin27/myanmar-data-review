import { describe, expect, it } from "vitest";
import { readCsv } from "../src/csv/dataset";
import { columnLabel } from "../src/csv/contracts";
import { executeLocal } from "../src/processing/execute";
import { engineBuild } from "../src/generated/engine-build";
import { ReviewModel, inspectionSettings } from "../src/review/model";
import { pack, validateSnapshot, parseBackup } from "../src/project/snapshot";
import { exportProject, spreadsheetRisk } from "../src/project/export";
import corpus from "./fixtures/detection-v1.json";
const id = "project-fixture";
const sample = (key: string) => corpus.cases.find((c) => c.id === key)!.input;
async function fixture(
  body = `ID,Text\r\n0001,"${sample("strong-zawgyi")}"\r\n0002,"${sample("ambiguous-common-subset")}"\r\n0003,=SUM(A1)\r\n`,
) {
  const file = new File([body], "source.csv", { type: "text/csv" });
  const options = { delimiter: "," as const, hasHeader: true };
  const dataset = await readCsv(file, options, id);
  const column = dataset.columns[1]!;
  const sources = [];
  for (let offset = 0; offset < dataset.rowCount; offset += 50)
    for (const [i, row] of dataset.page(offset, 50).rows.entries())
      sources.push({
        id: `${row.id}/${column.id}`,
        row: offset + i + 1,
        column: `${columnLabel(column)} · Column 2`,
        original: row.values[1]!,
      });
  const model = new ReviewModel(sources);
  const settings = { ...inspectionSettings, convertToUnicode: true };
  const generation = model.begin(settings, JSON.stringify(engineBuild));
  for (const cell of model.all())
    model.complete(
      cell.id,
      executeLocal({ text: cell.original, ...settings }),
      generation,
    );
  const input = () => ({
    file,
    datasetId: id,
    fingerprint: dataset.fingerprint,
    options,
    selected: [column.id],
    review: {
      cells: model.all(),
      settings: model.settings,
      engineIdentity: model.engineIdentity,
      inspected: true,
    },
  });
  return { dataset, model, input, file };
}
const exportOptions = {
  spreadsheetSafe: false,
  bom: false,
  includeText: false,
  acknowledge: true,
};
describe("reviewed export", () => {
  it("applies only revision-matched approved proposals, including manual replacement PRIVATE_TEST_VALUEs with retained findings", async () => {
    const { model, input, dataset } = await fixture();
    model.decide(model.all()[0]!.id, "approved");
    model.manual(model.all()[1]!.id, "manual replacement PRIVATE_TEST_VALUE");
    model.decide(model.all()[1]!.id, "approved");
    const { snapshot } = await pack(input());
    const output = exportProject(snapshot, dataset, exportOptions);
    const parsed = await readCsv(output.csv, snapshot.options, "output");
    expect(parsed.page(0).rows.map((r) => r.values)).toEqual([
      ["0001", model.all()[0]!.proposal!.text],
      ["0002", "manual replacement PRIVATE_TEST_VALUE"],
      ["0003", "=SUM(A1)"],
    ]);
    const report = JSON.parse(await output.report.text());
    expect(report.summary.changed).toBe(2);
    expect(report.summary.unresolved).toBe(1);
    expect(report.findings[0].decision).toBe("approved");
    expect(report.applied[0]).not.toHaveProperty("original");
    expect(report.applied[1]).not.toHaveProperty("value");
    expect(await output.report.text()).not.toContain(
      "manual replacement PRIVATE_TEST_VALUE",
    );
  });
  it("keeps unapproved and rejected originals, and requires acknowledgement", async () => {
    const { model, input, dataset } = await fixture();
    model.decide(model.all()[0]!.id, "rejected");
    const { snapshot } = await pack(input());
    expect(() =>
      exportProject(snapshot, dataset, {
        ...exportOptions,
        acknowledge: false,
      }),
    ).toThrow("Acknowledge");
    const output = exportProject(snapshot, dataset, exportOptions);
    const parsed = await readCsv(output.csv, snapshot.options, "output");
    expect(parsed.page(0).rows.map((r) => r.values)).toEqual(
      dataset.page(0).rows.map((r) => r.values),
    );
  });
  it("includes every row beyond previews, escapes risky headers and values explicitly, and supports BOM", async () => {
    const body =
      "=header,Text\r\n" +
      Array.from(
        { length: 151 },
        (_, i) =>
          `${String(i).padStart(4, "0")},"${i % 2 ? "=SUM(A1)" : "multi\nline"}"`,
      ).join("\r\n");
    const { dataset, input } = await fixture(body);
    const { snapshot } = await pack(input());
    const output = exportProject(snapshot, dataset, {
      ...exportOptions,
      spreadsheetSafe: true,
      bom: true,
    });
    const bytes = new Uint8Array(await output.csv.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    const parsed = await readCsv(output.csv, snapshot.options, "output");
    expect(parsed.rowCount).toBe(151);
    expect(parsed.columns[0]!.header).toBe("'=header");
    expect(parsed.page(150).rows[0]!.values[0]).toBe("0150");
    expect(output.summary.escaped).toHaveLength(76);
    expect(output.summary.escaped[0]).toEqual({
      row: 0,
      column: 1,
      header: true,
    });
  });
  it.each([
    "=1",
    " +1",
    "-2",
    "@x",
    "\ttext",
    "\rtext",
    "\ntext",
    "＝1",
    "  ＠x",
  ])("detects spreadsheet entry %j", (value) =>
    expect(spreadsheetRisk(value)).toBe(true),
  );
  it.each(["0012", "hello", "၅၂၀", "line\nline", "'already text"])(
    "keeps ordinary value %j",
    (value) => expect(spreadsheetRisk(value)).toBe(false),
  );
});
describe("project integrity", () => {
  it("round-trips source bytes, decisions, settings and pending status without rerunning", async () => {
    const { model, input, file } = await fixture();
    model.decide(model.all()[0]!.id, "approved");
    const { backup } = await pack(input());
    const restored = await validateSnapshot(parseBackup(await backup.text()));
    expect(await restored.file.arrayBuffer()).toEqual(await file.arrayBuffer());
    const review = restored.snapshot.review!;
    const model2 = ReviewModel.restore(
      review.cells,
      review.settings,
      review.engineIdentity,
    );
    expect(model2.all()).toEqual(model.all());
    model2.manual(model2.all()[0]!.id, "new revision");
    expect(model2.all()[0]!.proposal!.revision).toBeGreaterThan(
      model.all()[0]!.proposal!.revision,
    );
    expect(model2.all()[0]!.approvalRevision).toBeNull();
  });
  it("rejects wrong versions, fingerprints, identities, approvals and malformed spans", async () => {
    const { input } = await fixture();
    const { snapshot } = await pack(input());
    const mutations: ((value: typeof snapshot) => void)[] = [
      (v) => {
        Object.assign(v, { version: 2 });
      },
      (v) => {
        v.fingerprint = "0".repeat(64);
      },
      (v) => {
        Object.assign(v.review!.cells[0]!, { id: "wrong" });
      },
      (v) => {
        Object.assign(v.review!.cells[0]!, {
          decision: "approved",
          approvalRevision: 999,
        });
      },
      (v) => {
        Object.assign(v.review!.cells[0]!.result!.detection.segments[0]!, {
          start: 999999,
        });
      },
      (v) => {
        Object.assign(v.review!.cells[1]!.result!, { unresolvedReason: null });
      },
      (v) => {
        v.selected = ["nonexistent"];
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(snapshot);
      mutate(value);
      await expect(validateSnapshot(value)).rejects.toThrow();
    }
    expect(() => parseBackup("[".repeat(30) + "0" + "]".repeat(30))).toThrow(
      "deeply",
    );
    await expect(
      validateSnapshot(parseBackup('{"__proto__":{}}')),
    ).rejects.toThrow();
  });
});

it("round-trips delimiter/header variations, quotes, empty values, whitespace and newlines", async () => {
  for (const delimiter of [",", ";", "\t"] as const)
    for (const hasHeader of [true, false]) {
      const records = Array.from({ length: 80 }, (_, row) => [
        `000${row}`,
        row % 2 ? ` " ${delimiter} 😀\r\ntext ` : "",
        row % 3 ? "=1" : "၅၂၀",
      ]);
      const csv = records
        .map((values) =>
          values
            .map((v) => '"' + v.replaceAll('"', '""') + '"')
            .join(delimiter),
        )
        .join("\r\n");
      const file = new File([csv], "roundtrip.csv");
      const options = { delimiter, hasHeader };
      const dataset = await readCsv(file, options, "roundtrip");
      const { snapshot } = await pack({
        file,
        datasetId: "roundtrip",
        fingerprint: dataset.fingerprint,
        options,
        selected: [dataset.columns[1]!.id],
        review: null,
      });
      const output = exportProject(snapshot, dataset, exportOptions);
      const parsed = await readCsv(output.csv, options, "out");
      expect(parsed.rowCount).toBe(dataset.rowCount);
      expect(parsed.columns.map((c) => c.header)).toEqual(
        dataset.columns.map((c) => c.header),
      );
      for (let offset = 0; offset < parsed.rowCount; offset += 50)
        expect(parsed.page(offset, 50).rows.map((r) => r.values)).toEqual(
          dataset.page(offset, 50).rows.map((r) => r.values),
        );
    }
});
it("report text is opt-in and restored pending work is stopped without processing", async () => {
  const { input, model, dataset } = await fixture();
  model.decide(model.all()[0]!.id, "approved");
  const { snapshot } = await pack(input());
  const output = exportProject(snapshot, dataset, {
    ...exportOptions,
    includeText: true,
  });
  const report = JSON.parse(await output.report.text());
  expect(report.applied[0].original).toBe(model.all()[0]!.original);
  model.begin(inspectionSettings, JSON.stringify(engineBuild));
  model.running(model.all()[0]!.id, model.generation);
  const pending = (await pack(input())).snapshot.review!;
  const restored = ReviewModel.restore(
    pending.cells,
    pending.settings,
    pending.engineIdentity,
  );
  expect(restored.all()[0]!.processing).toBe("cancelled");
  expect(restored.all().every((c) => c.result === null)).toBe(true);
});
