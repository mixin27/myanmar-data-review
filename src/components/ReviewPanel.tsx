import { useI18n } from "../i18n";
import {
  changedRange,
  emptyFilters,
  filterCells,
  type ReviewFilters,
} from "../review/tools";
import type { DuplicateSnapshot } from "../review/model";
import { ProjectActions } from "./ProjectActions";
import type { OpenedProject } from "./ProjectLibrary";
import { useEffect, useMemo, useRef, useState } from "react";
import { createCsvSession } from "../csv/browser-client";
import type { CsvOptions, CsvSummary } from "../csv/contracts";
import { createLocalWorkerClient } from "../processing/browser-client";
import { engineBuild } from "../generated/engine-build";
import {
  ReviewModel,
  inspectionSettings,
  unresolved,
  eligible,
} from "../review/model";
import type {
  BulkSnapshot,
  Queue,
  ReviewCell,
  Settings,
} from "../review/model";
import { collectCells, ReviewRunner } from "../review/runner";
import {
  decisionLabel,
  diagnosticNames,
  encodingNames,
  finding,
  findingExplanation,
  spanText,
} from "../review/presentation";

const queueNames: Record<Queue, string> = {
  attention: "Needs attention",
  changes: "Proposed changes",
  approved: "Approved",
  kept: "Kept original",
  all: "All selected cells",
};
const count = (n: number) => n.toLocaleString("en-US");
export function ReviewPanel({
  file,
  options,
  summary,
  selected,
  onReviewStarted,
  restored,
  onProjectReadOnly,
  onDirty,
}: {
  file: File;
  options: CsvOptions;
  summary: CsvSummary;
  selected: ReadonlySet<string>;
  onReviewStarted: () => void;
  restored: OpenedProject | null;
  onProjectReadOnly: (value: boolean) => void;
  onDirty: (value: boolean) => void;
}) {
  const { t } = useI18n();

  const [model, setModel] = useState<ReviewModel | null>(() =>
    restored?.snapshot.review
      ? ReviewModel.restore(
          restored.snapshot.review.cells,
          restored.snapshot.review.settings,
          restored.snapshot.review.engineIdentity,
        )
      : null,
  );
  const [changeVersion, redraw] = useState(0);
  const [readOnly, setReadOnly] = useState(!!restored?.saved);
  const [ioBusy, setIoBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>(
    restored?.snapshot.review?.settings ?? inspectionSettings,
  );
  const [inspected, setInspected] = useState(
    restored?.snapshot.review?.inspected ?? false,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<Queue>("attention");
  const [filters, setFilters] = useState<ReviewFilters>(emptyFilters);
  const [jumpRow, setJumpRow] = useState("");
  const [duplicates, setDuplicates] = useState<DuplicateSnapshot | null>(null);
  const duplicateDialog = useRef<HTMLDialogElement>(null);
  const [offset, setOffset] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [bulk, setBulk] = useState<BulkSnapshot | null>(null);
  const [confirmation, setConfirmation] = useState<{
    settings: Settings;
    run: boolean;
  } | null>(null);
  const runner = useRef<ReviewRunner | null>(null);
  const importer = useRef<ReturnType<typeof createCsvSession> | null>(null);
  const revision = useRef(0);
  const modelRef = useRef<ReviewModel | null>(model);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const bulkDialog = useRef<HTMLDialogElement>(null);
  const restartDialog = useRef<HTMLDialogElement>(null);
  const refresh = () => redraw((value) => value + 1);
  useEffect(() => {
    runner.current = new ReviewRunner(createLocalWorkerClient(true));
    importer.current = createCsvSession();
    return () => {
      revision.current++;
      runner.current?.cancel();
      importer.current?.close();
    };
  }, []);
  const cells = model?.all() ?? [];
  const visible = filterCells(cells, queue, filters);
  const pageOffset = Math.min(
    offset,
    Math.max(0, Math.floor((visible.length - 1) / 25) * 25),
  );
  const complete = cells.filter(
    (cell) => cell.processing === "succeeded" || cell.processing === "failed",
  ).length;
  const active = activeId && model ? model.get(activeId) : null;
  const canBulk = !busy && !readOnly && !ioBusy && visible.some(eligible);
  const activeIndex = visible.findIndex((cell) => cell.id === activeId);
  const diff = useMemo(
    () =>
      active?.proposal
        ? changedRange(active.original, active.proposal.text)
        : null,
    [active?.original, active?.proposal],
  );
  function changeFilter(patch: Partial<ReviewFilters>) {
    setFilters((value) => ({ ...value, ...patch }));
    setOffset(0);
  }
  function moveCell(direction: number) {
    const cell = visible[activeIndex + direction];
    if (cell && activeIndex >= 0) {
      if (
        active &&
        manual !== (active.proposal?.text ?? active.original) &&
        !window.confirm(
          t("Discard the replacement text you have not proposed yet?"),
        )
      )
        return;
      openCell(cell);
    }
  }
  function report(action: () => void) {
    try {
      if (readOnly || ioBusy)
        throw new Error("This project is currently read-only.");
      if (busy) throw new Error("Wait for inspection before reviewing.");
      action();
      setError("");
      refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "This action could not be completed.",
      );
    }
  }
  async function run(nextSettings = settings) {
    if (readOnly || ioBusy) return;
    onReviewStarted();
    const current = ++revision.current;
    setBusy(true);
    setError("");
    setMessage("Preparing selected cells…");
    setOffset(0);
    setActiveId(null);
    setBulk(null);
    let currentModel = model;
    try {
      if (!currentModel) {
        const csv = importer.current!;
        await csv.open(file, options, summary.id);
        if (current !== revision.current) return;
        const sources = await collectCells(csv, summary, selected);
        if (current !== revision.current) return;
        csv.close();
        currentModel = new ReviewModel(sources);
        modelRef.current = currentModel;
        setModel(currentModel);
      }
      setMessage("Inspecting selected text. Originals stay unchanged.");
      const result = await runner.current!.run(
        currentModel,
        nextSettings,
        () => {
          if (current === revision.current) refresh();
        },
      );
      if (current !== revision.current) return;
      if (result === "complete") {
        setInspected(true);
        const failures = currentModel
          .all()
          .filter((cell) => cell.processing === "failed").length;
        setMessage(
          failures
            ? `Inspection finished with ${failures} failed cells. Review the incomplete results below.`
            : "Inspection complete. Review the findings below; changes need your approval.",
        );
      }
    } catch (error) {
      if (current === revision.current)
        setError(
          error instanceof Error
            ? error.message
            : "Inspection could not finish. Try again.",
        );
    } finally {
      if (current === revision.current) {
        importer.current?.close();
        setBusy(false);
        refresh();
      }
    }
  }
  function cancel() {
    revision.current++;
    importer.current?.close();
    runner.current?.cancel(modelRef.current ?? undefined);
    setBusy(false);
    setMessage(
      "Inspection stopped. Completed findings are kept; remaining cells are marked not inspected.",
    );
    refresh();
  }
  function requestChange(next: Settings, start: boolean) {
    if (readOnly || ioBusy) return;
    if (
      model &&
      cells.some(
        (cell) =>
          cell.result || cell.proposal || cell.decision !== "unreviewed",
      )
    ) {
      setConfirmation({ settings: next, run: start });
      restartDialog.current?.showModal();
    } else {
      setSettings(next);
      if (start) void run(next);
    }
  }
  function openCell(cell: ReviewCell) {
    setActiveId(cell.id);
    setManual(cell.proposal?.text ?? cell.original);
    detailDialog.current?.showModal();
  }
  return (
    <section className="review-workspace" aria-labelledby="review-title">
      <ProjectActions
        rows={summary.rowCount}
        working={busy}
        version={changeVersion}
        savedProject={restored?.saved ?? null}
        onReadOnly={(value) => {
          setReadOnly(value);
          onProjectReadOnly(value);
        }}
        onBusy={setIoBusy}
        onDirty={onDirty}
        input={() => ({
          file,
          datasetId: summary.id,
          fingerprint: summary.fingerprint,
          options,
          selected: [...selected],
          review: model
            ? {
                cells: model.all(),
                settings: model.settings,
                engineIdentity: model.engineIdentity,
                inspected,
              }
            : null,
        })}
      />
      {restored && (
        <p className="review-scope">
          {t(
            "Saved findings restored without running inspection. Start a new inspection explicitly to replace the restored findings and approvals. ",
          )}
        </p>
      )}

      <div className="review-intro">
        <div>
          <span className="eyebrow">{t("Review selected text")}</span>
          <h2 id="review-title">{t("See what needs attention")}</h2>
          <p>
            {t(
              "Check encoding and Burmese text structure. Inspect first, then choose whether to propose changes. ",
            )}
          </p>
        </div>
        <span className="local-pill">{t("Only on this device")}</span>
      </div>
      <div className="review-settings surface">
        <div>
          <strong>
            {count(summary.rowCount * selected.size)} {t("cells selected ")}
          </strong>
          <p>{t("Every row in your chosen columns is included.")}</p>
        </div>
        {inspected && (
          <fieldset disabled={busy || readOnly || ioBusy}>
            <legend>{t("Optional changes")}</legend>
            <label>
              <input
                type="checkbox"
                checked={settings.convertToUnicode}
                onChange={(event) =>
                  requestChange(
                    { ...settings, convertToUnicode: event.target.checked },
                    false,
                  )
                }
              />
              {t("Propose Unicode conversion ")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.normalizeNfc}
                onChange={(event) =>
                  requestChange(
                    { ...settings, normalizeNfc: event.target.checked },
                    false,
                  )
                }
              />
              {t("Normalize Unicode (NFC) ")}
            </label>
            <p>
              {t(
                "Uncertain or mixed text stays unresolved. Normalization does not correct spelling. ",
              )}
            </p>
          </fieldset>
        )}
        <div className="review-run-actions">
          <button
            className="button primary"
            disabled={busy || readOnly || ioBusy}
            onClick={() => requestChange(settings, true)}
          >
            {busy
              ? t("Inspecting…")
              : inspected
                ? t("Run inspection")
                : t("Inspect selected text")}
          </button>
          {busy && (
            <button className="button secondary" onClick={cancel}>
              {t("Stop inspection ")}
            </button>
          )}
        </div>
      </div>
      {(message || busy) && (
        <div className="review-progress" role="status">
          <p>{t(message)}</p>
          {model && (
            <span>
              {count(
                cells.filter((cell) => cell.processing === "succeeded").length,
              )}{" "}
              {t("of ")}
              {count(cells.length)} {t("cells inspected ")}
            </span>
          )}
          {busy && (
            <progress
              max={Math.max(1, cells.length)}
              value={complete}
              aria-label={t("Inspection progress")}
            />
          )}
        </div>
      )}
      {error && (
        <p className="error-panel" role="alert">
          {t(error)}
        </p>
      )}
      {model && (
        <>
          <div className="review-summary" aria-label={t("Review summary")}>
            <div>
              <strong>{count(cells.filter(unresolved).length)}</strong>
              <span>{t("Unresolved findings")}</span>
            </div>
            <div>
              <strong>
                {count(
                  cells.filter(
                    (cell) => !!cell.proposal && cell.decision === "unreviewed",
                  ).length,
                )}
              </strong>
              <span>{t("Awaiting approval")}</span>
            </div>
            <div>
              <strong>
                {count(
                  cells.filter((cell) => cell.decision === "approved").length,
                )}
              </strong>
              <span>{t("Approved changes")}</span>
            </div>
            <div>
              <strong>
                {count(
                  cells.filter((cell) => cell.processing !== "succeeded")
                    .length,
                )}
              </strong>
              <span>{t("Not successfully inspected")}</span>
            </div>
          </div>
          <div className="surface review-results">
            <div className="review-filters">
              <label>
                {t("Search text")}
                <input
                  type="search"
                  value={filters.query}
                  onChange={(event) =>
                    changeFilter({ query: event.target.value })
                  }
                />
              </label>
              <label>
                {t("Column")}
                <select
                  aria-label={t("Column")}
                  value={filters.column}
                  onChange={(event) =>
                    changeFilter({ column: event.target.value })
                  }
                >
                  <option value="">{t("All columns")}</option>
                  {[...new Set(cells.map((cell) => cell.column))].map(
                    (column) => (
                      <option key={column}>{column}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {t("Finding")}
                <select
                  aria-label={t("Finding")}
                  value={filters.finding}
                  onChange={(event) =>
                    changeFilter({ finding: event.target.value })
                  }
                >
                  <option value="">{t("All findings")}</option>
                  {[...new Set(cells.map(finding))].map((label) => (
                    <option key={t(label)} value={t(label)}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Decision")}
                <select
                  aria-label={t("Decision")}
                  value={filters.decision}
                  onChange={(event) =>
                    changeFilter({ decision: event.target.value })
                  }
                >
                  <option value="">{t("All decisions")}</option>
                  <option value="unreviewed">{t("Unreviewed")}</option>
                  <option value="approved">{t("Approved")}</option>
                  <option value="rejected">{t("Kept original")}</option>
                </select>
              </label>
              <button
                className="button secondary"
                onClick={() => {
                  setFilters(emptyFilters);
                  setQueue("all");
                  setOffset(0);
                }}
              >
                {t("Clear filters")}
              </button>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const index = cells.findIndex(
                    (cell) => cell.row === Number(jumpRow),
                  );
                  if (index < 0) {
                    setError("Enter a row number from this file.");
                    return;
                  }
                  setFilters(emptyFilters);
                  setQueue("all");
                  setOffset(Math.floor(index / 25) * 25);
                  setError("");
                  openCell(cells[index]!);
                }}
              >
                <label>
                  {t("Row number")}
                  <input
                    type="number"
                    min="1"
                    max={summary.rowCount}
                    step="1"
                    required
                    value={jumpRow}
                    onChange={(event) => setJumpRow(event.target.value)}
                  />
                </label>
                <button className="button secondary" disabled={busy}>
                  {t("Go to row")}
                </button>
              </form>
            </div>
            <div className="review-toolbar">
              <label>
                {t("Show")}{" "}
                <select
                  aria-label={t("Review queue")}
                  value={queue}
                  onChange={(event) => {
                    setQueue(event.target.value as Queue);
                    setOffset(0);
                  }}
                >
                  {Object.entries(queueNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button secondary"
                disabled={!canBulk}
                onClick={() => {
                  setBulk(
                    model.snapshot(
                      queue,
                      new Set(visible.map((cell) => cell.id)),
                    ),
                  );
                  bulkDialog.current?.showModal();
                }}
              >
                {t("Approve eligible changes ")}
              </button>
              <button
                className="button secondary"
                disabled={busy || readOnly || ioBusy || !model.canUndo}
                onClick={() =>
                  report(() => {
                    model.undo();
                    setMessage("Last review action undone.");
                  })
                }
              >
                {t("Undo last review action")}
              </button>
            </div>
            <p className="review-help">
              {t(
                "Undo keeps recent actions in this tab. A new inspection or a very large action clears undo history.",
              )}
            </p>
            <p className="review-help">
              {queue === "attention"
                ? t(
                    "Unconfirmed encoding is not necessarily incorrect text. This view also includes structural findings and incomplete inspections. Keeping an original does not resolve its findings.",
                  )
                : t(
                    "Approvals apply to a specific proposed value. Original data is always preserved.",
                  )}
            </p>
            {visible.length === 0 ? (
              <div className="review-empty">
                <h3>
                  {busy
                    ? t("Findings will appear as inspection progresses")
                    : t("No cells in this view")}
                </h3>
                <p>
                  {busy
                    ? t("You can stop at any time.")
                    : t(
                        "Use All selected cells to see encoding evidence and inspection status for every selected value.",
                      )}
                </p>
              </div>
            ) : (
              <>
                <div
                  className="review-table-scroll"
                  tabIndex={0}
                  aria-label={t("Cell review results")}
                >
                  <table className="review-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("Cell")}</th>
                        <th scope="col">{t("Original")}</th>
                        <th scope="col">{t("Proposed value")}</th>
                        <th scope="col">{t("Finding")}</th>
                        <th scope="col">{t("Decision")}</th>
                        <th scope="col">
                          <span className="sr-only">{t("Action")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible
                        .slice(pageOffset, pageOffset + 25)
                        .map((cell) => (
                          <tr key={cell.id}>
                            <th scope="row">
                              {t("Row ")}
                              {count(cell.row)}
                              <small>{cell.column}</small>
                            </th>
                            <td>
                              <span className="review-value">
                                {cell.original
                                  ? cell.original.slice(0, 160) +
                                    (cell.original.length > 160 ? "…" : "")
                                  : t("(empty)")}
                              </span>
                            </td>
                            <td>
                              <span className="review-value">
                                {cell.proposal
                                  ? cell.proposal.text
                                    ? cell.proposal.text.slice(0, 160) +
                                      (cell.proposal.text.length > 160
                                        ? "…"
                                        : "")
                                    : t("(empty)")
                                  : "—"}
                              </span>
                            </td>
                            <td>{t(finding(cell))}</td>
                            <td>
                              <span
                                className={`decision-badge ${cell.decision}`}
                              >
                                {t(decisionLabel(cell))}
                              </span>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                disabled={busy}
                                aria-label={`${t("Review row")} ${cell.row}, ${cell.column}`}
                                onClick={() => openCell(cell)}
                              >
                                {t("Review ")}
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <span>
                    {count(pageOffset + 1)}
                    {t("– ")}
                    {count(Math.min(pageOffset + 25, visible.length))} {t("of")}{" "}
                    {count(visible.length)} {t("cells ")}
                  </span>
                  <div>
                    <button
                      className="button page-button"
                      disabled={pageOffset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 25))}
                    >
                      {t("Previous ")}
                    </button>
                    <button
                      className="button page-button"
                      disabled={pageOffset + 25 >= visible.length}
                      onClick={() => setOffset(pageOffset + 25)}
                    >
                      {t("Next ")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <p className="review-scope">
            {t(
              "These checks identify encoding evidence and supported Burmese structure issues, not spelling or meaning. Other Myanmar-script languages may fall outside the structure rules. ",
            )}
          </p>
        </>
      )}
      <dialog
        onKeyDown={(event) => {
          if (
            !event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            (event.target instanceof Element &&
              event.target.closest(
                "input, textarea, select, [contenteditable]",
              ))
          )
            return;
          if (
            event.key.toLowerCase() === "n" ||
            event.key.toLowerCase() === "p"
          ) {
            event.preventDefault();
            moveCell(event.key.toLowerCase() === "n" ? 1 : -1);
          }
        }}
        ref={detailDialog}
        className="cell-dialog"
        onClose={() => setActiveId(null)}
        aria-labelledby="cell-title"
      >
        {active && (
          <>
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">{active.column}</span>
                <h2 id="cell-title">
                  {t("Review row ")}
                  {count(active.row)}
                </h2>
              </div>
              <button
                className="button secondary"
                onClick={() => detailDialog.current?.close()}
              >
                {t("Close ")}
              </button>
            </div>
            <div className="cell-navigation">
              <button
                className="button secondary"
                disabled={busy || activeIndex <= 0}
                onClick={() => moveCell(-1)}
              >
                {t("Previous cell")}
              </button>
              <span>
                {t("Move through the filtered results · Alt+P / Alt+N")}
              </span>
              <button
                className="button secondary"
                disabled={
                  busy || activeIndex < 0 || activeIndex >= visible.length - 1
                }
                onClick={() => moveCell(1)}
              >
                {t("Next cell")}
              </button>
            </div>
            <p className="finding-banner">
              {t(finding(active))} {t("· ")}
              {t(decisionLabel(active))}
            </p>
            {findingExplanation(active) && (
              <p className="finding-explanation">
                {t(findingExplanation(active)!)}
              </p>
            )}
            {active.error && <p role="alert">{t(active.error)}</p>}
            <div className="value-comparison">
              <div>
                <h3>{t("Original value")}</h3>
                <pre>
                  {diff ? (
                    <>
                      {diff.prefix}
                      <mark className="diff-removed">{diff.removed}</mark>
                      {diff.suffix}
                    </>
                  ) : (
                    active.original || "(empty)"
                  )}
                </pre>
              </div>
              <div>
                <h3>
                  {active.proposal?.provenance === "manual"
                    ? t("Your replacement")
                    : t("Proposed value")}
                </h3>
                <pre>
                  {diff ? (
                    <>
                      {diff.prefix}
                      <mark className="diff-added">{diff.added}</mark>
                      {diff.suffix}
                    </>
                  ) : active.proposal ? (
                    active.proposal.text || "(empty)"
                  ) : (
                    t("No change proposed")
                  )}
                </pre>
                {active.proposal?.provenance === "manual" && (
                  <p>
                    {t("Manually entered. Not verified by the text checks.")}
                  </p>
                )}
              </div>
            </div>
            {diff && (
              <p className="review-help">
                {t(
                  "Highlighted text shows the changed range, including any unchanged characters between edits.",
                )}
              </p>
            )}
            {active.result && (
              <details className="evidence">
                <summary>{t("Why this was flagged")}</summary>
                <p>
                  {t(encodingNames[active.result.detection.encoding])}
                  {t(
                    ". Encoding evidence is not a guarantee of linguistic correctness. ",
                  )}
                </p>
                {active.result.unresolvedReason && (
                  <p>
                    {active.result.unresolvedReason === "conversion_required"
                      ? t(
                          "Enable Unicode conversion after inspection to request a proposed value.",
                        )
                      : t(
                          "No automatic conversion was made because the text has mixed or uncertain encoding.",
                        )}
                  </p>
                )}
                {active.result.detection.segments
                  .slice(0, 100)
                  .map((segment, i) => (
                    <p key={i}>
                      <mark>
                        {spanText(
                          active.result!.detection.input,
                          segment.start,
                          segment.end,
                        )}
                      </mark>{" "}
                      {t("— ")}
                      {t(encodingNames[segment.encoding])}
                    </p>
                  ))}
                {active.result.detection.segments.length > 100 && (
                  <p>{t("Showing the first 100 text segments.")}</p>
                )}
                {(
                  [
                    ["Original structure", active.result.originalValidation],
                    [
                      "Automatic result structure",
                      active.result.changed ? active.result.validation : null,
                    ],
                  ] as const
                ).map(
                  ([label, value]) =>
                    typeof value === "object" &&
                    value && (
                      <div key={t(String(label))}>
                        <h4>{t(String(label))}</h4>
                        {value.diagnostics.length === 0 ? (
                          <p>{t("No supported structural issues found.")}</p>
                        ) : (
                          value.diagnostics
                            .slice(0, 100)
                            .map((diagnostic, index) => (
                              <p key={index}>
                                {t(
                                  diagnosticNames[diagnostic.code] ??
                                    diagnostic.code,
                                )}
                                {t(":")}{" "}
                                <mark>
                                  {spanText(
                                    value.input,
                                    diagnostic.start,
                                    diagnostic.end,
                                  )}
                                </mark>
                              </p>
                            ))
                        )}
                        {value.diagnostics.length > 100 && (
                          <p>{t("Showing the first 100 findings.")}</p>
                        )}
                      </div>
                    ),
                )}
              </details>
            )}
            <details className="manual-edit">
              <summary>{t("Write a replacement")}</summary>
              <fieldset disabled={readOnly || ioBusy}>
                <p>
                  {t(
                    "Create a proposal, then approve it separately. Existing findings remain visible; manual text is not automatically verified. ",
                  )}
                </p>
                <label htmlFor="manual-value">{t("Replacement text")}</label>
                <textarea
                  id="manual-value"
                  value={manual}
                  maxLength={100000}
                  onChange={(event) => setManual(event.target.value)}
                  rows={4}
                />
                <button
                  className="button secondary"
                  onClick={() =>
                    report(() => {
                      model!.manual(active.id, manual);
                      setMessage(
                        "Replacement proposed. Approve it separately when you are ready.",
                      );
                    })
                  }
                >
                  {t("Propose replacement ")}
                </button>
              </fieldset>
            </details>
            {unresolved(active) && (
              <p className="review-scope">
                {t(
                  "Keeping the original or approving a manual replacement records your decision. It does not confirm the encoding or clear the original findings. ",
                )}
              </p>
            )}
            <details className="duplicate-review">
              <summary>{t("Review matching values")}</summary>
              <p>
                {t(
                  "Apply one decision to exact matching originals in this column, including matches outside your filters. Original findings stay visible. Manual replacements need individual approval.",
                )}
              </p>
              <div className="cell-navigation">
                {(["rejected", "approved"] as const).map((decision) => (
                  <button
                    key={decision}
                    className="button secondary"
                    disabled={
                      busy ||
                      readOnly ||
                      ioBusy ||
                      !model?.duplicateSnapshot(active.id, decision).targets
                        .length
                    }
                    onClick={() => {
                      setDuplicates(
                        model!.duplicateSnapshot(active.id, decision),
                      );
                      duplicateDialog.current?.showModal();
                    }}
                  >
                    {decision === "approved"
                      ? t("Approve matching eligible changes")
                      : t("Keep matching originals")}
                  </button>
                ))}
              </div>
            </details>
            <fieldset className="cell-actions" disabled={readOnly || ioBusy}>
              <button
                className="button secondary"
                onClick={() =>
                  report(() => {
                    model!.decide(active.id, "rejected");
                    detailDialog.current?.close();
                    setOffset(0);
                  })
                }
              >
                {t("Keep original ")}
              </button>
              {active.decision !== "unreviewed" && (
                <button
                  className="text-button"
                  onClick={() =>
                    report(() => model!.decide(active.id, "unreviewed"))
                  }
                >
                  {t("Revoke decision ")}
                </button>
              )}
              <button
                className="button primary"
                disabled={
                  !active.proposal ||
                  active.decision === "approved" ||
                  (active.proposal.provenance === "engine" &&
                    unresolved(active))
                }
                onClick={() =>
                  report(() => {
                    model!.decide(active.id, "approved");
                    detailDialog.current?.close();
                    setOffset(0);
                  })
                }
              >
                {t("Approve change ")}
              </button>
            </fieldset>
          </>
        )}
      </dialog>
      <dialog
        ref={duplicateDialog}
        aria-labelledby="duplicate-title"
        className="confirm-dialog"
        onClose={() => setDuplicates(null)}
      >
        {duplicates && (
          <>
            <h2 id="duplicate-title">{t("Confirm matching values")}</h2>
            <p>
              {duplicates.targets.length} {t("matching cells · ")}
              {duplicates.decision === "approved"
                ? t("Approve changes")
                : t("Keep original")}
            </p>
            <p>
              {t(
                "Only exact originals in the same column are included. Approval requires identical eligible proposed values. Recent actions can be undone within the session memory limit.",
              )}
            </p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => duplicateDialog.current?.close()}
              >
                {t("Cancel")}
              </button>
              <button
                className="button"
                disabled={busy || readOnly || ioBusy}
                onClick={() =>
                  report(() => {
                    model!.decideDuplicates(duplicates);
                    duplicateDialog.current?.close();
                    detailDialog.current?.close();
                    setMessage("Decision applied to matching values.");
                  })
                }
              >
                {t("Confirm decision")}
              </button>
            </div>
          </>
        )}
      </dialog>
      <dialog
        ref={bulkDialog}
        className="confirm-dialog"
        aria-labelledby="bulk-title"
      >
        <h2 id="bulk-title">
          {t("Approve ")}
          {count(bulk?.targets.length ?? 0)} {t("changes? ")}
        </h2>
        <p>
          {t(
            "Only completed automatic proposals without blocking findings from “ ",
          )}
          {t(queueNames[queue])}
          {t(
            "” are included. Manual replacements and unresolved cells are excluded. Originals remain preserved. ",
          )}
        </p>
        <div className="dialog-actions">
          <button
            className="button secondary"
            onClick={() => bulkDialog.current?.close()}
          >
            {t("Cancel ")}
          </button>
          <button
            className="button primary"
            onClick={() =>
              report(() => {
                model!.approveBulk(bulk!);
                bulkDialog.current?.close();
                setOffset(0);
                setMessage("Selected changes approved.");
              })
            }
          >
            {t("Confirm approval ")}
          </button>
        </div>
      </dialog>
      <dialog
        ref={restartDialog}
        className="confirm-dialog"
        aria-labelledby="restart-title"
      >
        <h2 id="restart-title">{t("Start a new review?")}</h2>
        <p>
          {t(
            "This clears the current findings, proposals and approvals for these columns. Original values remain unchanged. ",
          )}
        </p>
        <div className="dialog-actions">
          <button
            className="button secondary"
            onClick={() => restartDialog.current?.close()}
          >
            {t("Keep current review ")}
          </button>
          <button
            className="button primary"
            onClick={() => {
              if (!confirmation) return;
              const next = confirmation;
              restartDialog.current?.close();
              setSettings(next.settings);
              setBulk(null);
              setOffset(0);
              model?.begin(next.settings, JSON.stringify(engineBuild));
              setMessage(
                "Settings changed. Run inspection to create new findings and proposals.",
              );
              refresh();
              if (next.run) void run(next.settings);
            }}
          >
            {t("Start new review ")}
          </button>
        </div>
      </dialog>
    </section>
  );
}
