import type { ProcessingResult } from "../processing/contracts";

export const REVIEW_LIMITS = {
  cells: 10_000,
  resultCodeUnits: 16_000_000,
} as const;
export type Settings = Readonly<{
  convertToUnicode: boolean;
  normalizeNfc: boolean;
}>;
export const inspectionSettings: Settings = {
  convertToUnicode: false,
  normalizeNfc: false,
};
export type ProcessingState =
  "not_run" | "running" | "succeeded" | "failed" | "cancelled";
export type Decision = "unreviewed" | "approved" | "rejected";
export interface SourceCell {
  readonly id: string;
  readonly row: number;
  readonly column: string;
  readonly original: string;
}
export interface Proposal {
  readonly text: string;
  readonly revision: number;
  readonly provenance: "engine" | "manual";
}
export interface ReviewCell extends SourceCell {
  readonly processing: ProcessingState;
  readonly result: ProcessingResult | null;
  readonly error: string | null;
  readonly proposal: Proposal | null;
  readonly decision: Decision;
  readonly approvalRevision: number | null;
}
export type Queue = "attention" | "changes" | "approved" | "kept" | "all";
export interface BulkSnapshot {
  readonly generation: number;
  readonly targets: readonly Readonly<{ id: string; revision: number }>[];
}
export function unresolved(cell: ReviewCell): boolean {
  return (
    !!cell.result?.unresolvedReason ||
    !!cell.result?.validation?.diagnostics.length
  );
}
export function eligible(cell: ReviewCell): boolean {
  return (
    cell.processing === "succeeded" &&
    !unresolved(cell) &&
    cell.proposal?.provenance === "engine" &&
    cell.decision === "unreviewed"
  );
}
export function matches(cell: ReviewCell, queue: Queue): boolean {
  switch (queue) {
    case "attention":
      return unresolved(cell) || cell.processing !== "succeeded";
    case "changes":
      return !!cell.proposal && cell.decision === "unreviewed";
    case "approved":
      return cell.decision === "approved";
    case "kept":
      return cell.decision === "rejected";
    default:
      return true;
  }
}
export function selectedValue(cell: ReviewCell): string {
  return cell.decision === "approved" &&
    cell.proposal &&
    cell.approvalRevision === cell.proposal.revision
    ? cell.proposal.text
    : cell.original;
}
export class ReviewModel {
  private cells = new Map<string, ReviewCell>();
  private proposalRevision = 0;
  generation = 0;
  settings: Settings = inspectionSettings;
  engineIdentity = "";
  constructor(sources: readonly SourceCell[]) {
    if (sources.length > REVIEW_LIMITS.cells)
      throw new Error(
        "Select fewer text columns or split this file. Review supports up to 10,000 selected cells at a time.",
      );
    for (const source of sources) {
      if (this.cells.has(source.id))
        throw new Error("Duplicate cell identity.");
      this.cells.set(source.id, {
        ...source,
        processing: "not_run",
        result: null,
        error: null,
        proposal: null,
        decision: "unreviewed",
        approvalRevision: null,
      });
    }
  }
  all(): ReviewCell[] {
    return [...this.cells.values()];
  }
  get(id: string): ReviewCell {
    const cell = this.cells.get(id);
    if (!cell) throw new Error("This cell is no longer available.");
    return cell;
  }
  private set(id: string, patch: Partial<ReviewCell>) {
    this.cells.set(id, { ...this.get(id), ...patch });
  }
  begin(settings: Settings, engineIdentity: string): number {
    this.generation++;
    this.settings = { ...settings };
    this.engineIdentity = engineIdentity;
    for (const cell of this.cells.values())
      this.set(cell.id, {
        processing: "not_run",
        result: null,
        error: null,
        proposal: null,
        decision: "unreviewed",
        approvalRevision: null,
      });
    return this.generation;
  }
  running(id: string, generation: number) {
    if (generation === this.generation) this.set(id, { processing: "running" });
  }
  complete(id: string, result: ProcessingResult, generation: number) {
    if (generation !== this.generation) return;
    const cell = this.get(id);
    if (
      result.original !== cell.original ||
      JSON.stringify(result.engine) !== this.engineIdentity
    )
      throw new Error("The result does not match this review.");
    this.set(id, {
      result,
      processing: "succeeded",
      error: null,
      proposal: result.changed
        ? {
            text: result.output,
            provenance: "engine",
            revision: ++this.proposalRevision,
          }
        : null,
      decision: "unreviewed",
      approvalRevision: null,
    });
  }
  fail(id: string, message: string, generation: number) {
    if (generation === this.generation)
      this.set(id, {
        processing: "failed",
        error: message,
        proposal: null,
        decision: "unreviewed",
        approvalRevision: null,
      });
  }
  stop() {
    this.generation++;
    for (const cell of this.cells.values())
      if (cell.processing === "running" || cell.processing === "not_run")
        this.set(cell.id, { processing: "cancelled" });
  }
  manual(id: string, text: string) {
    const cell = this.get(id);
    if (cell.processing === "running" || cell.processing === "not_run")
      throw new Error("Wait for inspection before editing.");
    if (
      text.length > 100_000 ||
      Array.from(text).some((character) => /^[\uD800-\uDFFF]$/u.test(character))
    )
      throw new Error("Enter valid text with at most 100,000 characters.");
    this.set(id, {
      proposal:
        text === cell.original
          ? null
          : { text, provenance: "manual", revision: ++this.proposalRevision },
      decision: "unreviewed",
      approvalRevision: null,
    });
  }
  decide(id: string, decision: Decision) {
    const cell = this.get(id);
    if (cell.processing === "running" || cell.processing === "not_run")
      throw new Error("Wait for inspection before reviewing.");
    if (
      decision === "approved" &&
      (!cell.proposal ||
        (cell.proposal.provenance === "engine" &&
          (unresolved(cell) || cell.processing !== "succeeded")))
    )
      throw new Error("This proposal needs a manual review before approval.");
    this.set(id, {
      decision,
      approvalRevision:
        decision === "approved" ? cell.proposal!.revision : null,
    });
  }
  snapshot(queue: Queue): BulkSnapshot {
    return {
      generation: this.generation,
      targets: this.all()
        .filter((cell) => matches(cell, queue) && eligible(cell))
        .map((cell) => ({ id: cell.id, revision: cell.proposal!.revision })),
    };
  }
  approveBulk(snapshot: BulkSnapshot) {
    if (
      snapshot.generation !== this.generation ||
      !snapshot.targets.length ||
      snapshot.targets.some((target) => {
        const cell = this.cells.get(target.id);
        return (
          !cell ||
          !eligible(cell) ||
          cell.proposal?.revision !== target.revision
        );
      })
    )
      throw new Error(
        "The selected changes have changed. Review the selection again.",
      );
    for (const target of snapshot.targets) this.decide(target.id, "approved");
  }
}
