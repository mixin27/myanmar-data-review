import { useEffect, useRef, useState } from "react";
import { createCsvSession } from "../csv/browser-client";
import type { CsvOptions, CsvSummary } from "../csv/contracts";
import { createLocalWorkerClient } from "../processing/browser-client";
import { engineBuild } from "../generated/engine-build";
import {
  ReviewModel,
  inspectionSettings,
  matches,
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
}: {
  file: File;
  options: CsvOptions;
  summary: CsvSummary;
  selected: ReadonlySet<string>;
  onReviewStarted: () => void;
}) {
  const [model, setModel] = useState<ReviewModel | null>(null);
  const [, redraw] = useState(0);
  const [settings, setSettings] = useState<Settings>(inspectionSettings);
  const [inspected, setInspected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<Queue>("attention");
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
  const modelRef = useRef<ReviewModel | null>(null);
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
  const visible = cells.filter((cell) => matches(cell, queue));
  const complete = cells.filter(
    (cell) => cell.processing === "succeeded" || cell.processing === "failed",
  ).length;
  const active = activeId && model ? model.get(activeId) : null;
  const canBulk = !busy && visible.some(eligible);
  function report(action: () => void) {
    try {
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
      <div className="review-intro">
        <div>
          <span className="eyebrow">Review selected text</span>
          <h2 id="review-title">See what needs attention</h2>
          <p>
            Check encoding and Burmese text structure. Inspect first, then
            choose whether to propose changes.
          </p>
        </div>
        <span className="local-pill">Only on this device</span>
      </div>
      <div className="review-settings surface">
        <div>
          <strong>
            {count(summary.rowCount * selected.size)} cells selected
          </strong>
          <p>Every row in your chosen columns is included.</p>
        </div>
        {inspected && (
          <fieldset disabled={busy}>
            <legend>Optional changes</legend>
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
              Propose Unicode conversion
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
              Normalize Unicode (NFC)
            </label>
            <p>
              Uncertain or mixed text stays unresolved. Normalization does not
              correct spelling.
            </p>
          </fieldset>
        )}
        <div className="review-run-actions">
          <button
            className="button primary"
            disabled={busy}
            onClick={() => requestChange(settings, true)}
          >
            {busy
              ? "Inspecting…"
              : inspected
                ? "Run inspection"
                : "Inspect selected text"}
          </button>
          {busy && (
            <button className="button secondary" onClick={cancel}>
              Stop inspection
            </button>
          )}
        </div>
      </div>
      {(message || busy) && (
        <div className="review-progress" role="status">
          <p>{message}</p>
          {model && (
            <span>
              {count(
                cells.filter((cell) => cell.processing === "succeeded").length,
              )}{" "}
              of {count(cells.length)} cells inspected
            </span>
          )}
          {busy && (
            <progress
              max={Math.max(1, cells.length)}
              value={complete}
              aria-label="Inspection progress"
            />
          )}
        </div>
      )}
      {error && (
        <p className="error-panel" role="alert">
          {error}
        </p>
      )}
      {model && (
        <>
          <div className="review-summary" aria-label="Review summary">
            <div>
              <strong>{count(cells.filter(unresolved).length)}</strong>
              <span>Unresolved findings</span>
            </div>
            <div>
              <strong>
                {count(
                  cells.filter(
                    (cell) => !!cell.proposal && cell.decision === "unreviewed",
                  ).length,
                )}
              </strong>
              <span>Awaiting approval</span>
            </div>
            <div>
              <strong>
                {count(
                  cells.filter((cell) => cell.decision === "approved").length,
                )}
              </strong>
              <span>Approved changes</span>
            </div>
            <div>
              <strong>
                {count(
                  cells.filter((cell) => cell.processing !== "succeeded")
                    .length,
                )}
              </strong>
              <span>Not successfully inspected</span>
            </div>
          </div>
          <div className="surface review-results">
            <div className="review-toolbar">
              <label>
                Show{" "}
                <select
                  aria-label="Review queue"
                  value={queue}
                  onChange={(event) => {
                    setQueue(event.target.value as Queue);
                    setOffset(0);
                  }}
                >
                  {Object.entries(queueNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button secondary"
                disabled={!canBulk}
                onClick={() => {
                  setBulk(model.snapshot(queue));
                  bulkDialog.current?.showModal();
                }}
              >
                Approve eligible changes
              </button>
            </div>
            <p className="review-help">
              {queue === "attention"
                ? "Unconfirmed encoding is not necessarily incorrect text. This view also includes structural findings and incomplete inspections. Keeping an original does not resolve its findings."
                : "Approvals apply to a specific proposed value. Original data is always preserved."}
            </p>
            {visible.length === 0 ? (
              <div className="review-empty">
                <h3>
                  {busy
                    ? "Findings will appear as inspection progresses"
                    : "No cells in this view"}
                </h3>
                <p>
                  {busy
                    ? "You can stop at any time."
                    : "Use All selected cells to see encoding evidence and inspection status for every selected value."}
                </p>
              </div>
            ) : (
              <>
                <div
                  className="review-table-scroll"
                  tabIndex={0}
                  aria-label="Cell review results"
                >
                  <table className="review-table">
                    <thead>
                      <tr>
                        <th scope="col">Cell</th>
                        <th scope="col">Original</th>
                        <th scope="col">Proposed value</th>
                        <th scope="col">Finding</th>
                        <th scope="col">Decision</th>
                        <th scope="col">
                          <span className="sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.slice(offset, offset + 25).map((cell) => (
                        <tr key={cell.id}>
                          <th scope="row">
                            Row {count(cell.row)}
                            <small>{cell.column}</small>
                          </th>
                          <td>
                            <span className="review-value">
                              {cell.original
                                ? cell.original.slice(0, 160) +
                                  (cell.original.length > 160 ? "…" : "")
                                : "(empty)"}
                            </span>
                          </td>
                          <td>
                            <span className="review-value">
                              {cell.proposal
                                ? cell.proposal.text
                                  ? cell.proposal.text.slice(0, 160) +
                                    (cell.proposal.text.length > 160 ? "…" : "")
                                  : "(empty)"
                                : "—"}
                            </span>
                          </td>
                          <td>{finding(cell)}</td>
                          <td>
                            <span className={`decision-badge ${cell.decision}`}>
                              {decisionLabel(cell)}
                            </span>
                          </td>
                          <td>
                            <button
                              className="text-button"
                              disabled={busy}
                              aria-label={`Review row ${cell.row}, ${cell.column}`}
                              onClick={() => openCell(cell)}
                            >
                              Review
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <span>
                    {count(offset + 1)}–
                    {count(Math.min(offset + 25, visible.length))} of{" "}
                    {count(visible.length)} cells
                  </span>
                  <div>
                    <button
                      className="button page-button"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 25))}
                    >
                      Previous
                    </button>
                    <button
                      className="button page-button"
                      disabled={offset + 25 >= visible.length}
                      onClick={() => setOffset(offset + 25)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <p className="review-scope">
            These checks identify encoding evidence and supported Burmese
            structure issues, not spelling or meaning. Other Myanmar-script
            languages may fall outside the structure rules.
          </p>
        </>
      )}
      <dialog
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
                <h2 id="cell-title">Review row {count(active.row)}</h2>
              </div>
              <button
                className="button secondary"
                onClick={() => detailDialog.current?.close()}
              >
                Close
              </button>
            </div>
            <p className="finding-banner">
              {finding(active)} · {decisionLabel(active)}
            </p>
            {findingExplanation(active) && (
              <p className="finding-explanation">
                {findingExplanation(active)}
              </p>
            )}
            {active.error && <p role="alert">{active.error}</p>}
            <div className="value-comparison">
              <div>
                <h3>Original value</h3>
                <pre>{active.original || "(empty)"}</pre>
              </div>
              <div>
                <h3>
                  {active.proposal?.provenance === "manual"
                    ? "Your replacement"
                    : "Proposed value"}
                </h3>
                <pre>
                  {active.proposal
                    ? active.proposal.text || "(empty)"
                    : "No change proposed"}
                </pre>
                {active.proposal?.provenance === "manual" && (
                  <p>Manually entered. Not verified by the text checks.</p>
                )}
              </div>
            </div>
            {active.result && (
              <details className="evidence">
                <summary>Why this was flagged</summary>
                <p>
                  {encodingNames[active.result.detection.encoding]}. Encoding
                  evidence is not a guarantee of linguistic correctness.
                </p>
                {active.result.unresolvedReason && (
                  <p>
                    {active.result.unresolvedReason === "conversion_required"
                      ? "Enable Unicode conversion after inspection to request a proposed value."
                      : "No automatic conversion was made because the text has mixed or uncertain encoding."}
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
                      — {encodingNames[segment.encoding]}
                    </p>
                  ))}
                {active.result.detection.segments.length > 100 && (
                  <p>Showing the first 100 text segments.</p>
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
                      <div key={String(label)}>
                        <h4>{String(label)}</h4>
                        {value.diagnostics.length === 0 ? (
                          <p>No supported structural issues found.</p>
                        ) : (
                          value.diagnostics
                            .slice(0, 100)
                            .map((diagnostic, index) => (
                              <p key={index}>
                                {diagnosticNames[diagnostic.code]}:{" "}
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
                          <p>Showing the first 100 findings.</p>
                        )}
                      </div>
                    ),
                )}
              </details>
            )}
            <details className="manual-edit">
              <summary>Write a replacement</summary>
              <p>
                Create a proposal, then approve it separately. Existing findings
                remain visible; manual text is not automatically verified.
              </p>
              <label htmlFor="manual-value">Replacement text</label>
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
                Propose replacement
              </button>
            </details>
            {unresolved(active) && (
              <p className="review-scope">
                Keeping the original or approving a manual replacement records
                your decision. It does not confirm the encoding or clear the
                original findings.
              </p>
            )}
            <div className="cell-actions">
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
                Keep original
              </button>
              {active.decision !== "unreviewed" && (
                <button
                  className="text-button"
                  onClick={() =>
                    report(() => model!.decide(active.id, "unreviewed"))
                  }
                >
                  Revoke decision
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
                Approve change
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
          Approve {count(bulk?.targets.length ?? 0)} changes?
        </h2>
        <p>
          Only completed automatic proposals without blocking findings from “
          {queueNames[queue]}” are included. Manual replacements and unresolved
          cells are excluded. Originals remain preserved.
        </p>
        <div className="dialog-actions">
          <button
            className="button secondary"
            onClick={() => bulkDialog.current?.close()}
          >
            Cancel
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
            Confirm approval
          </button>
        </div>
      </dialog>
      <dialog
        ref={restartDialog}
        className="confirm-dialog"
        aria-labelledby="restart-title"
      >
        <h2 id="restart-title">Start a new review?</h2>
        <p>
          This clears the current findings, proposals and approvals for these
          columns. Original values remain unchanged.
        </p>
        <div className="dialog-actions">
          <button
            className="button secondary"
            onClick={() => restartDialog.current?.close()}
          >
            Keep current review
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
            Start new review
          </button>
        </div>
      </dialog>
    </section>
  );
}
