import { expect, it, vi } from "vitest";
import corpus from "./fixtures/detection-v1.json";
import { executeLocal } from "../src/processing/execute";
import { LocalWorkerClient } from "../src/processing/worker-client";
import { ReviewModel, inspectionSettings } from "../src/review/model";
import { ReviewRunner } from "../src/review/runner";

it("measures retained review results and applies a bounded result budget", async () => {
  for (const [name, total, text] of [
    ["short plain text", 10000, "hello"],
    [
      "Myanmar evidence",
      10000,
      corpus.cases.find((value) => value.id === "strong-unicode")!.input,
    ],
  ] as const) {
    const client = new LocalWorkerClient(() => {
      throw new Error("unused");
    });
    vi.spyOn(client, "execute").mockImplementation(async (input) =>
      executeLocal(input),
    );
    const model = new ReviewModel(
      Array.from({ length: total }, (_, i) => ({
        id: `${i}`,
        row: i + 1,
        column: "Text",
        original: text,
      })),
    );
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    let limited = false;
    try {
      await new ReviewRunner(client).run(model, inspectionSettings, () => {});
    } catch {
      limited = true;
    }
    const completed = model
      .all()
      .filter((cell) => cell.processing === "succeeded").length;
    expect(completed).toBeGreaterThan(0);
    if (limited)
      expect(model.all().some((cell) => cell.error?.includes("memory"))).toBe(
        true,
      );
    else expect(completed).toBe(total);
    console.log(
      `Review ${name}: ${completed}/${total}, ${Math.round(performance.now() - start)}ms, heap delta ${((process.memoryUsage().heapUsed - before) / 1024 / 1024).toFixed(1)} MiB, limited=${limited}`,
    );
  }
}, 30000);
