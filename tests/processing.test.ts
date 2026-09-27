import { describe, expect, it } from "vitest";
import { createMyanLexApplication } from "@myanlex/application";
import corpus from "./fixtures/detection-v1.json";
import { executeLocal } from "../src/processing/execute";
import { isWorkerRequest } from "../src/processing/contracts";

const application = createMyanLexApplication();
describe("pinned application integration", () => {
  it.each(corpus.cases)(
    "preserves original and detection parity: $id",
    ({ input }) => {
      const result = executeLocal({
        text: input,
        convertToUnicode: false,
        normalizeNfc: false,
      });
      expect(result.original).toBe(input);
      expect(result.output).toBe(input);
      expect(result.detection).toEqual(application.detectText({ text: input }));
      expect(result.conversion).toBeNull();
      expect(result.normalization).toBeNull();
      for (const segment of result.detection.segments) {
        expect(
          Array.from(result.detection.input)
            .slice(segment.start, segment.end)
            .join(""),
        ).toBe(segment.text);
      }
    },
  );
  it.each(corpus.cases)(
    "guards conversion and normalization: $id",
    ({ input }) => {
      const result = executeLocal({
        text: input,
        convertToUnicode: true,
        normalizeNfc: true,
      });
      const detection = application.detectText({ text: input });
      if (
        detection.encoding === "mixed" ||
        detection.encoding === "unknown" ||
        detection.segments.some((s) => s.encoding === "unknown")
      ) {
        expect(result.unresolvedReason).not.toBeNull();
        expect(result.output).toBe(input);
        expect(result.normalization).toBeNull();
        expect(result.validation).toBeNull();
        expect(result.conversion).toBeNull();
      } else {
        let output = input;
        if (detection.encoding === "zawgyi") {
          const conversion = application.convertText({
            text: input,
            from: "zawgyi",
            to: "unicode",
            validateSource: true,
          });
          expect(result.conversion).toEqual(conversion);
          output = conversion.output;
        }
        const normalized = application.normalizeText({ text: output });
        expect(result.normalization).toEqual(normalized);
        expect(result.output).toBe(normalized.output);
        if (detection.encoding !== "non_myanmar")
          expect(result.validation).toEqual(
            application.validateOrthography({ text: normalized.output }),
          );
      }
    },
  );
  it("does not normalize unconverted Zawgyi", () => {
    const text = corpus.cases.find(
      (sample) => sample.id === "strong-zawgyi",
    )!.input;
    const result = executeLocal({
      text,
      convertToUnicode: false,
      normalizeNfc: true,
    });
    expect(result.unresolvedReason).toBe("conversion_required");
    expect(result.normalization).toBeNull();
  });
  it("rejects malformed scalars and the upstream resource limit", () => {
    expect(() =>
      executeLocal({
        text: "\ud800",
        convertToUnicode: false,
        normalizeNfc: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_unicode" }));
    expect(() =>
      executeLocal({
        text: "x".repeat(100001),
        convertToUnicode: false,
        normalizeNfc: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "text_too_long" }));
  });
  it("validates protocol envelopes before invoking the engine", () => {
    expect(isWorkerRequest(null)).toBe(false);
    expect(
      isWorkerRequest({
        protocol: 1,
        id: 1,
        revision: 0,
        input: { text: "x", convertToUnicode: false, normalizeNfc: false },
      }),
    ).toBe(true);
    expect(
      isWorkerRequest({ protocol: 1, id: 1, revision: -1, input: {} }),
    ).toBe(false);
  });
});
