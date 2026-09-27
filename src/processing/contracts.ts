import type {
  MyanmarEncodingDetectionResult,
  MyanmarEncodingConversionResult,
  NormalizationResult,
  BurmeseOrthographyValidationResult,
} from "@myanlex/types";
import type { engineBuild } from "../generated/engine-build";

export interface ProcessingInput {
  readonly text: string;
  readonly convertToUnicode: boolean;
  readonly normalizeNfc: boolean;
}

export interface ProcessingResult {
  readonly original: string;
  readonly output: string;
  readonly changed: boolean;
  readonly detection: MyanmarEncodingDetectionResult;
  readonly conversion: MyanmarEncodingConversionResult | null;
  readonly normalization: NormalizationResult | null;
  readonly validation: BurmeseOrthographyValidationResult | null;
  readonly unresolvedReason:
    "encoding_mixed" | "encoding_uncertain" | "conversion_required" | null;
  readonly engine: typeof engineBuild;
}

export interface WorkerRequest {
  readonly protocol: 1;
  readonly id: number;
  readonly revision: number;
  readonly input: ProcessingInput;
}

export type WorkerResponse = {
  readonly protocol: 1;
  readonly id: number;
  readonly revision: number;
} & (
  | { readonly ok: true; readonly result: ProcessingResult }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    }
);

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<WorkerRequest>;
  return (
    request.protocol === 1 &&
    Number.isSafeInteger(request.id) &&
    (request.id ?? -1) >= 0 &&
    Number.isSafeInteger(request.revision) &&
    (request.revision ?? -1) >= 0 &&
    !!request.input &&
    typeof request.input.text === "string" &&
    typeof request.input.convertToUnicode === "boolean" &&
    typeof request.input.normalizeNfc === "boolean"
  );
}
