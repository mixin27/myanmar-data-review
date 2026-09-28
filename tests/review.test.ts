import { describe, expect, it, vi } from "vitest";
import corpus from "./fixtures/detection-v1.json";
import { executeLocal } from "../src/processing/execute";
import { engineBuild } from "../src/generated/engine-build";
import {
  ReviewModel,
  inspectionSettings,
  unresolved,
  selectedValue,
  matches,
  REVIEW_LIMITS,
} from "../src/review/model";
import { ReviewRunner } from "../src/review/runner";
import {
  LocalWorkerClient,
  LocalProcessingError,
} from "../src/processing/worker-client";
import { spanText } from "../src/review/presentation";
const sample = (id: string) =>
  corpus.cases.find((value) => value.id === id)!.input;
const sources = [
  "strong-zawgyi",
  "ambiguous-common-subset",
  "standard-shan-is-not-zawgyi",
  "mixed-separated-runs",
  "latin-and-emoji",
].map((id, index) => ({
  id,
  row: index + 1,
  column: "Name",
  original: sample(id),
}));
const identity = JSON.stringify(engineBuild);
function ready(convertToUnicode = true) {
  const model = new ReviewModel(sources);
  const settings = { convertToUnicode, normalizeNfc: false };
  const generation = model.begin(settings, identity);
  for (const cell of model.all())
    model.complete(
      cell.id,
      executeLocal({ text: cell.original, ...settings }),
      generation,
    );
  return model;
}
describe("review policy", () => {
  it("inspection proposes nothing; conversion creates an unapproved revision without changing originals", () => {
    const inspected = ready(false);
    expect(inspected.all().every((cell) => !cell.proposal)).toBe(true);
    const model = ready();
    const cell = model.get("strong-zawgyi");
    expect(cell.proposal?.text).not.toBe(cell.original);
    expect(selectedValue(cell)).toBe(cell.original);
    model.decide(cell.id, "approved");
    expect(selectedValue(model.get(cell.id))).toBe(cell.result!.output);
    model.decide(cell.id, "unreviewed");
    expect(selectedValue(model.get(cell.id))).toBe(cell.original);
  });
  it("uncertainty and unsupported structure survive manual approval and keeping originals", () => {
    const model = ready();
    for (const id of [
      "ambiguous-common-subset",
      "standard-shan-is-not-zawgyi",
      "mixed-separated-runs",
    ]) {
      expect(unresolved(model.get(id))).toBe(true);
      model.decide(id, "rejected");
      expect(unresolved(model.get(id))).toBe(true);
      model.manual(id, "Replacement 😀");
      expect(model.get(id).decision).toBe("unreviewed");
      model.decide(id, "approved");
      expect(unresolved(model.get(id))).toBe(true);
      expect(selectedValue(model.get(id))).toBe("Replacement 😀");
      expect(model.get(id).proposal?.provenance).toBe("manual");
    }
  });
  it("manual revisions, settings and engine identity invalidate approval; stale results cannot return", () => {
    const model = ready();
    const id = "strong-zawgyi";
    model.decide(id, "approved");
    model.manual(id, "replacement");
    expect(model.get(id).approvalRevision).toBeNull();
    model.decide(id, "approved");
    const old = model.generation;
    const result = model.get(id).result!;
    model.begin(inspectionSettings, "new engine");
    model.complete(id, result, old);
    expect(model.get(id).result).toBeNull();
    expect(model.get(id).proposal).toBeNull();
    expect(model.get(id).approvalRevision).toBeNull();
    expect(() => model.complete(id, result, model.generation)).toThrow();
  });
  it("bulk targets are fixed across filter changes; changed revisions cancel the whole action", () => {
    const model = ready();
    const snapshot = model.snapshot("changes");
    expect(snapshot.targets.map((cell) => cell.id)).toEqual(["strong-zawgyi"]);
    expect(
      model.all().filter((cell) => matches(cell, "attention")).length,
    ).toBeGreaterThan(0);
    model.approveBulk(snapshot);
    expect(model.get("strong-zawgyi").decision).toBe("approved");
    model.decide("strong-zawgyi", "unreviewed");
    const stale = model.snapshot("all");
    model.manual("strong-zawgyi", "manual");
    expect(() => model.approveBulk(stale)).toThrow();
    expect(model.get("strong-zawgyi").decision).toBe("unreviewed");
    expect(model.snapshot("all").targets).toHaveLength(0);
  });
  it("failed and cancelled cells never look unchanged, and completed findings survive stop", () => {
    const model = ready();
    const generation = model.begin(inspectionSettings, identity);
    model.complete(
      sources[0]!.id,
      executeLocal({ text: sources[0]!.original, ...inspectionSettings }),
      generation,
    );
    model.fail(sources[1]!.id, "Could not inspect", generation);
    model.running(sources[2]!.id, generation);
    model.stop();
    expect(model.all().map((cell) => cell.processing)).toEqual([
      "succeeded",
      "failed",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    expect(
      model.all().every((cell) => selectedValue(cell) === cell.original),
    ).toBe(true);
  });
  it("protects limits, cell identities, scalar validity and exact code-point spans", () => {
    expect(
      () =>
        new ReviewModel(
          Array.from({ length: REVIEW_LIMITS.cells + 1 }, () => sources[0]!),
        ),
    ).toThrow();
    expect(() => new ReviewModel([sources[0]!, sources[0]!])).toThrow();
    const model = ready();
    expect(() => model.manual(sources[0]!.id, "\ud800")).toThrow();
    expect(() => model.manual(sources[0]!.id, "a".repeat(100001))).toThrow();
    expect(spanText("😀abc", 1, 3)).toBe("ab");
  });
});
describe("dataset runner", () => {
  it("continues per-cell input failures and preserves every selected identity", async () => {
    const client = new LocalWorkerClient(() => {
      throw new Error("unused");
    });
    vi.spyOn(client, "execute").mockImplementation(async (input) => {
      if (input.text === sources[1]!.original)
        throw new LocalProcessingError("invalid_unicode", "invalid");
      return executeLocal(input);
    });
    const model = new ReviewModel(sources);
    await new ReviewRunner(client).run(model, inspectionSettings, () => {});
    expect(
      model.all().filter((cell) => cell.processing === "succeeded"),
    ).toHaveLength(4);
    expect(model.get(sources[1]!.id).processing).toBe("failed");
    expect(client.execute).toHaveBeenCalledTimes(5);
  });
  it("stops on a worker failure and preserves partial findings without implicit retry", async () => {
    const client = new LocalWorkerClient(() => {
      throw new Error("unused");
    });
    vi.spyOn(client, "execute")
      .mockResolvedValueOnce(
        executeLocal({ text: sources[0]!.original, ...inspectionSettings }),
      )
      .mockRejectedValue(new LocalProcessingError("timeout", "timeout"));
    const model = new ReviewModel(sources);
    await expect(
      new ReviewRunner(client).run(model, inspectionSettings, () => {}),
    ).rejects.toThrow();
    expect(model.all().map((cell) => cell.processing)).toEqual([
      "succeeded",
      "failed",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    expect(client.execute).toHaveBeenCalledTimes(2);
  });
});

it("result budget stops explicitly with completed cells retained", async () => {
  const client = new LocalWorkerClient(() => {
    throw new Error("unused");
  });
  vi.spyOn(client, "execute").mockImplementation(async (input) =>
    executeLocal(input),
  );
  const firstResult = executeLocal({
    text: sources[0]!.original,
    ...inspectionSettings,
  });
  const model = new ReviewModel(sources);
  await expect(
    new ReviewRunner(client, JSON.stringify(firstResult).length + 1).run(
      model,
      inspectionSettings,
      () => {},
    ),
  ).rejects.toThrow("memory");
  expect(model.all().map((cell) => cell.processing)).toEqual([
    "succeeded",
    "failed",
    "cancelled",
    "cancelled",
    "cancelled",
  ]);
});
it("bulk approval validates every revision before approving any target", () => {
  const model = new ReviewModel([
    sources[0]!,
    { ...sources[0]!, id: "second", row: 2 },
  ]);
  const settings = { ...inspectionSettings, convertToUnicode: true };
  const generation = model.begin(settings, identity);
  for (const cell of model.all())
    model.complete(
      cell.id,
      executeLocal({ text: cell.original, ...settings }),
      generation,
    );
  const snapshot = model.snapshot("changes");
  expect(snapshot.targets).toHaveLength(2);
  model.manual("second", "manual revision");
  expect(() => model.approveBulk(snapshot)).toThrow();
  expect(model.all().every((cell) => cell.decision === "unreviewed")).toBe(
    true,
  );
});
it("original and output diagnostics retain their exact analyzed strings", () => {
  for (const source of sources) {
    const result = executeLocal({
      text: source.original,
      convertToUnicode: true,
      normalizeNfc: true,
    });
    if (result.originalValidation)
      expect(result.originalValidation.input).toBe(source.original);
    if (result.validation) expect(result.validation.input).toBe(result.output);
    for (const validation of [result.originalValidation, result.validation])
      for (const diagnostic of validation?.diagnostics ?? []) {
        expect(
          spanText(validation!.input, diagnostic.start, diagnostic.end).length,
        ).toBeGreaterThan(0);
      }
  }
});

it("explains uncertainty and disabled conversion without overriding upstream evidence", async () => {
  const { findingExplanation, decisionLabel } =
    await import("../src/review/presentation");
  const model = ready(false);
  const unknown = model.get("ambiguous-common-subset");
  expect(decisionLabel(unknown)).toBe("Encoding unconfirmed");
  expect(findingExplanation(unknown)).toContain(
    "does not mean the text is wrong",
  );
  expect(unresolved(unknown)).toBe(true);
  expect(decisionLabel(model.get("strong-zawgyi"))).toBe(
    "Conversion not enabled",
  );
  expect(findingExplanation(model.get("strong-zawgyi"))).toContain(
    "enable Propose Unicode conversion",
  );
});
