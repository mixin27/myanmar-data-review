// Only the worker imports this module in the application bundle.
import { createMyanLexApplication } from "@myanlex/application";
import { engineBuild } from "../generated/engine-build";
import type { ProcessingInput, ProcessingResult } from "./contracts";

const application = createMyanLexApplication();

export function executeLocal(input: ProcessingInput): ProcessingResult {
  const detection = application.detectText({ text: input.text });
  let output = input.text;
  let conversion: ProcessingResult["conversion"] = null;
  let normalization: ProcessingResult["normalization"] = null;
  let validation: ProcessingResult["validation"] = null;
  let unresolvedReason: ProcessingResult["unresolvedReason"] = null;

  if (detection.encoding === "mixed") unresolvedReason = "encoding_mixed";
  else if (
    detection.encoding === "unknown" ||
    detection.segments.some((segment) => segment.encoding === "unknown")
  ) {
    unresolvedReason = "encoding_uncertain";
  } else if (detection.encoding === "zawgyi") {
    if (input.convertToUnicode) {
      conversion = application.convertText({
        text: output,
        from: "zawgyi",
        to: "unicode",
        validateSource: true,
      });
      output = conversion.output;
    } else unresolvedReason = "conversion_required";
  }

  // Known Unicode, non-Myanmar, or guarded conversion output only. This is product
  // stage policy, not an alternative detector, normalizer, or linguistic rule.
  if (!unresolvedReason) {
    if (input.normalizeNfc) {
      normalization = application.normalizeText({ text: output });
      output = normalization.output;
    }
    if (detection.encoding !== "non_myanmar")
      validation = application.validateOrthography({ text: output });
  }
  return {
    original: input.text,
    output,
    changed: output !== input.text,
    detection,
    conversion,
    normalization,
    validation,
    unresolvedReason,
    engine: engineBuild,
  };
}
