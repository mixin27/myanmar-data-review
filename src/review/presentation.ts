import type { ReviewCell } from "./model";
import { unresolved } from "./model";
export const encodingNames = {
  unicode: "Unicode evidence",
  zawgyi: "Zawgyi evidence",
  mixed: "Mixed encoding",
  unknown: "Uncertain encoding",
  non_myanmar: "No Myanmar text",
};
export function finding(cell: ReviewCell): string {
  if (cell.processing === "failed") return "Inspection failed";
  if (cell.processing === "cancelled") return "Not inspected · stopped";
  if (cell.processing === "running") return "Inspecting";
  if (!cell.result) return "Not inspected";
  if (cell.result.unresolvedReason === "encoding_mixed")
    return "Mixed encoding · review needed";
  if (cell.result.unresolvedReason === "encoding_uncertain")
    return "Uncertain encoding · review needed";
  if (cell.result.unresolvedReason === "conversion_required")
    return "Zawgyi · conversion available";
  if (cell.result.validation?.diagnostics.length)
    return "Structure needs review";
  return encodingNames[cell.result.detection.encoding];
}
export function decisionLabel(cell: ReviewCell): string {
  if (cell.decision === "approved") return "Approved";
  if (cell.decision === "rejected") return "Keep original";
  if (cell.proposal) return "Awaiting approval";
  if (cell.result?.unresolvedReason === "conversion_required")
    return "Conversion not enabled";
  if (cell.result?.unresolvedReason === "encoding_uncertain")
    return "Encoding unconfirmed";
  return unresolved(cell) ? "Unresolved" : "Unreviewed";
}
export const diagnosticNames: Record<string, string> = {
  component_order: "Unexpected character order",
  duplicate_component: "Repeated character component",
  orphan_mark: "Mark without a supported base letter",
  dangling_virama: "Joining mark without a following consonant",
  unsupported_stack_target: "Unsupported joined consonant",
  invalid_syllable_start: "Unexpected syllable start",
  unsupported_myanmar: "Outside the supported Burmese structure rules",
};
// Offsets belong to this exact analyzed string and count code points, including emoji.
export function spanText(input: string, start: number, end: number): string {
  return Array.from(input).slice(start, end).join("");
}

export function findingExplanation(cell: ReviewCell): string | null {
  switch (cell.result?.unresolvedReason) {
    case "encoding_uncertain":
      return "The encoding could not be confirmed. This does not mean the text is wrong. Myanmar numerals, punctuation and some short words can look the same in Unicode and Zawgyi. We keep the original rather than guess. If it already reads correctly, you can choose Keep original; its encoding will remain unconfirmed.";
    case "conversion_required":
      return "Zawgyi evidence was found, but conversion is not enabled. Close this panel, enable Propose Unicode conversion, then run inspection to create a proposed value.";
    case "encoding_mixed":
      return "Different parts of this value show Unicode and Zawgyi evidence. The original is preserved because converting the whole value could change text that is already Unicode. Review it before writing a replacement.";
    default:
      return null;
  }
}
