import { describe, expect, it } from "vitest";
import { executeLocal } from "../src/processing/execute";
import { engineBuild } from "../src/generated/engine-build";
import { ReviewModel, selectedValue, unresolved } from "../src/review/model";
import { changedRange, emptyFilters, filterCells } from "../src/review/tools";
import corpus from "./fixtures/detection-v1.json";
const original = corpus.cases.find(
  (value) => value.id === "strong-zawgyi",
)!.input;
function ready() {
  const model = new ReviewModel([
    { id: "a", row: 1, column: "Text · Column 1", original },
    { id: "b", row: 2, column: "Text · Column 1", original },
    { id: "c", row: 1, column: "Other · Column 2", original },
    { id: "d", row: 3, column: "Text · Column 1", original: "Plain value" },
  ]);
  const settings = { convertToUnicode: true, normalizeNfc: false };
  const generation = model.begin(settings, JSON.stringify(engineBuild));
  for (const cell of model.all())
    model.complete(
      cell.id,
      executeLocal({ text: cell.original, ...settings }),
      generation,
    );
  return model;
}
describe("review productivity with unchanged export policy", () => {
  it("combines text, column, decision and finding filters; searches proposals too", () => {
    const model = ready();
    model.manual("d", "New proposed value");
    expect(
      filterCells(model.all(), "all", {
        ...emptyFilters,
        query: "NEW PROPOSED",
      }).map((cell) => cell.id),
    ).toEqual(["d"]);
    model.decide("a", "approved");
    expect(
      filterCells(model.all(), "all", {
        ...emptyFilters,
        column: "Text · Column 1",
        decision: "approved",
        finding: "Unicode evidence",
      }),
    ).toHaveLength(0);
    expect(
      filterCells(model.all(), "all", {
        ...emptyFilters,
        column: "Text · Column 1",
        decision: "approved",
      }).map((cell) => cell.id),
    ).toEqual(["a"]);
    expect(
      filterCells(model.all(), "attention", {
        ...emptyFilters,
        query: "not present",
      }),
    ).toEqual([]);
    expect(selectedValue(model.get("a"))).not.toBe(original);
  });
  it("bulk approval targets only the filtered selection and undoes atomically", () => {
    const model = ready();
    const snapshot = model.snapshot("changes", new Set(["a", "b"]));
    model.approveBulk(snapshot);
    expect(model.get("c").decision).toBe("unreviewed");
    expect(model.get("a").decision).toBe("approved");
    model.undo();
    expect(model.all().every((cell) => cell.decision === "unreviewed")).toBe(
      true,
    );
    expect(model.canUndo).toBe(false);
  });
  it("undo restores proposal and revision-bound approval without changing findings", () => {
    const model = ready();
    model.decide("a", "approved");
    const approved = model.get("a");
    model.manual("a", "manual");
    model.undo();
    expect(model.get("a")).toEqual(approved);
    expect(selectedValue(model.get("a"))).toBe(approved.proposal!.text);
    model.decide("a", "rejected");
    model.undo();
    expect(model.get("a")).toEqual(approved);
    model.begin(model.settings, model.engineIdentity);
    expect(model.canUndo).toBe(false);
    expect(() => model.undo()).toThrow();
  });
  it("does not reuse proposal revisions after undo", () => {
    const model = ready();
    model.manual("a", "first");
    const revision = model.get("a").proposal!.revision;
    model.undo();
    model.manual("a", "second");
    expect(model.get("a").proposal!.revision).toBeGreaterThan(revision);
  });
  it("caps undo history and starts restored projects with no history", () => {
    const model = ready();
    for (let i = 0; i < 60; i++) model.manual("d", `edit ${i}`);
    for (let i = 0; i < 50; i++) model.undo();
    expect(model.canUndo).toBe(false);
    expect(model.get("d").proposal!.text).toBe("edit 9");
    model.decide("d", "approved");
    expect(
      ReviewModel.restore(model.all(), model.settings, model.engineIdentity)
        .canUndo,
    ).toBe(false);
    model.stop();
    expect(model.canUndo).toBe(false);
  });
  it("approves only exact originals and identical eligible proposals in the same column", () => {
    const model = ready(),
      snapshot = model.duplicateSnapshot("a", "approved");
    expect(snapshot.targets.map((target) => target.id)).toEqual(["a", "b"]);
    model.decideDuplicates(snapshot);
    expect(model.get("a").decision).toBe("approved");
    expect(model.get("b").decision).toBe("approved");
    expect(model.get("c").decision).toBe("unreviewed");
    model.undo();
    expect(model.get("a").decision).toBe("unreviewed");
    expect(model.get("b").decision).toBe("unreviewed");
  });
  it("rejects an entire stale duplicate snapshot, including replaced manual proposals", () => {
    const model = ready(),
      snapshot = model.duplicateSnapshot("a", "approved");
    model.manual("b", model.get("b").proposal!.text);
    expect(() => model.decideDuplicates(snapshot)).toThrow("changed");
    expect(model.get("a").decision).toBe("unreviewed");
    expect(model.duplicateSnapshot("b", "approved").targets).toHaveLength(0);
    expect(
      model
        .duplicateSnapshot("a", "approved")
        .targets.map((target) => target.id),
    ).toEqual(["a"]);
  });
  it("keeping matching originals retains unresolved findings and can be undone", () => {
    const model = ready();
    const generation = model.begin(
      { convertToUnicode: false, normalizeNfc: false },
      JSON.stringify(engineBuild),
    );
    for (const cell of model.all())
      model.complete(
        cell.id,
        executeLocal({
          text: cell.original,
          convertToUnicode: false,
          normalizeNfc: false,
        }),
        generation,
      );
    model.decideDuplicates(model.duplicateSnapshot("a", "rejected"));
    expect(unresolved(model.get("a"))).toBe(true);
    expect(selectedValue(model.get("a"))).toBe(original);
    expect(model.get("b").decision).toBe("rejected");
    model.undo();
    expect(model.get("b").decision).toBe("unreviewed");
  });
  it("diff reconstructs exact inputs without splitting combining marks or emoji", () => {
    for (const [before, after] of [
      ["aမင်္ဂလာ😀z", "aမင်္ဂလာ👩‍👧z"],
      ["x", ""],
      ["", "new"],
      ["same", "same"],
      ["éx", "ex"],
      ["a".repeat(10000) + "old", "a".repeat(10000) + "new"],
    ]) {
      const diff = changedRange(before!, after!);
      expect(diff.prefix + diff.removed + diff.suffix).toBe(before);
      expect(diff.prefix + diff.added + diff.suffix).toBe(after);
    }
    expect(changedRange("éx", "ex").removed).toBe("é");
    expect(changedRange("😀", "👩‍👧").added).toBe("👩‍👧");
  });
});
