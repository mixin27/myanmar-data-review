import type { CsvSession } from "../csv/client";
import { columnLabel } from "../csv/contracts";
import type { CsvSummary } from "../csv/contracts";
import type { LocalWorkerClient } from "../processing/worker-client";
import { LocalProcessingError } from "../processing/worker-client";
import { engineBuild } from "../generated/engine-build";
import { REVIEW_LIMITS, ReviewModel } from "./model";
import type { Settings, SourceCell } from "./model";

export async function collectCells(
  session: CsvSession,
  summary: CsvSummary,
  selected: ReadonlySet<string>,
): Promise<SourceCell[]> {
  const columns = summary.columns.filter((column) => selected.has(column.id));
  if (!columns.length || columns.length !== selected.size)
    throw new Error("Choose the text columns to inspect.");
  if (summary.rowCount * columns.length > REVIEW_LIMITS.cells)
    throw new Error(
      "Select fewer text columns or split this file. Review supports up to 10,000 selected cells at a time.",
    );
  const cells: SourceCell[] = [];
  for (let offset = 0; offset < summary.rowCount; offset += 50) {
    const page = await session.page(offset, 50);
    for (const [index, row] of page.rows.entries())
      for (const column of columns)
        cells.push({
          id: `${row.id}/${column.id}`,
          row: offset + index + 1,
          column: `${columnLabel(column)} · Column ${column.index + 1}`,
          original: row.values[column.index]!,
        });
  }
  return cells;
}

export class ReviewRunner {
  private token = 0;
  constructor(
    private readonly client: LocalWorkerClient,
    private readonly resultBudget: number = REVIEW_LIMITS.resultCodeUnits,
  ) {}
  cancel(model?: ReviewModel) {
    this.token++;
    this.client.cancel();
    model?.stop();
  }
  async run(
    model: ReviewModel,
    settings: Settings,
    update: () => void,
  ): Promise<"complete" | "cancelled"> {
    const token = ++this.token;
    const generation = model.begin(settings, JSON.stringify(engineBuild));
    let resultUnits = 0;
    const cells = model.all();
    update();
    try {
      for (let index = 0; index < cells.length; index++) {
        if (token !== this.token) return "cancelled";
        const cell = cells[index]!;
        model.running(cell.id, generation);
        try {
          const result = await this.client.execute(
            { text: cell.original, ...settings },
            generation,
          );
          if (token !== this.token) return "cancelled";
          resultUnits += JSON.stringify(result).length;
          if (resultUnits > this.resultBudget)
            throw new LocalProcessingError(
              "result_limit",
              "This review needs more memory than the current limit allows. Select fewer columns or split the file.",
            );
          model.complete(cell.id, result, generation);
        } catch (error) {
          if (token !== this.token) return "cancelled";
          const recoverable =
            error instanceof LocalProcessingError &&
            ["invalid_unicode", "text_too_long"].includes(error.code);
          model.fail(
            cell.id,
            recoverable
              ? "This value could not be inspected. Review or replace it manually."
              : error instanceof LocalProcessingError &&
                  error.code === "result_limit"
                ? error.message
                : "Inspection stopped. Start a new review to retry; completed findings are retained.",
            generation,
          );
          if (!recoverable) {
            model.stop();
            update();
            throw new Error(model.get(cell.id).error!, { cause: error });
          }
        }
        if (index % 25 === 0 || index === cells.length - 1) update();
      }
      return "complete";
    } finally {
      if (token === this.token) {
        this.client.cancel();
        update();
      }
    }
  }
}
