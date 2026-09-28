import { useEffect, useRef, useState } from "react";
import type {
  ExportOptions,
  ProjectInput,
  ProjectSnapshot,
} from "../project/contracts";
import { ProjectClient, download } from "../project/client";
import { summarize } from "../project/export";
import { acquireWriter, writeProject } from "../project/storage";
import type { SavedProject, WriterLease } from "../project/storage";

export function ProjectActions({
  input,
  rows,
  working,
  version,
  savedProject,
  onReadOnly,
  onBusy,
  onDirty,
}: {
  input: () => ProjectInput;
  rows: number;
  working: boolean;
  version: number;
  savedProject: SavedProject | null;
  onReadOnly: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void;
}) {
  const [saved, setSaved] = useState<SavedProject | null>(savedProject);
  const [savedVersion, setSavedVersion] = useState(savedProject ? version : -1);
  useEffect(() => {
    onDirty(!saved || savedVersion !== version);
  }, [saved, savedVersion, version]);
  const [preparing, setPreparing] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [readOnly, setReadOnly] = useState(!!savedProject);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    spreadsheetSafe: false,
    bom: false,
    includeText: false,
    acknowledge: false,
  });
  const [frozenInput, setFrozenInput] = useState<ProjectInput | null>(null);
  const [artifact, setArtifact] = useState<{
    csv: Blob;
    report: Blob;
    escaped: { row: number; column: number; header: boolean }[];
  } | null>(null);
  const client = useRef(new ProjectClient());
  const lease = useRef<WriterLease | null>(null);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const saveDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    if (savedProject) {
      onReadOnly(true);
      void acquireWriter(savedProject.id)
        .then((value) => {
          if (disposed) {
            value.release();
            return;
          }
          lease.current = value;
          setReadOnly(!value.writable);
          onReadOnly(!value.writable);
        })
        .catch(() => {
          if (!disposed)
            setError(
              "This project can only be viewed here. Download a backup to preserve a copy.",
            );
        });
    }
    return () => {
      disposed = true;
      alive.current = false;
      client.current.cancel();
      lease.current?.release();
      lease.current = null;
    };
    // A new loaded project remounts this component. Callback changes must not release a lease.
  }, []);
  async function task(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    onBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error
            ? error.message
            : "The operation could not finish.",
        );
    } finally {
      if (alive.current) {
        setPending(false);
        onBusy(false);
      }
    }
  }
  async function prepare(job: Parameters<ProjectClient["run"]>[0]) {
    setPreparing(true);
    try {
      return await client.current.run(job);
    } finally {
      if (alive.current) setPreparing(false);
    }
  }
  async function save() {
    if (readOnly) return;
    const currentVersion = version;
    const result = await prepare({ type: "pack", input: input() });
    if (result.type !== "packed" || !alive.current) return;
    const writer =
      lease.current ?? (await acquireWriter(saved?.id ?? crypto.randomUUID()));
    if (!alive.current) {
      writer.release();
      return;
    }
    lease.current = writer;
    const next = await writeProject(
      result.snapshot,
      writer,
      saved?.revision ?? 0,
    );
    if (!alive.current) return;
    setSaved(next);
    setSavedVersion(currentVersion);
    setStatus("Saved on this device. Later changes need Save changes.");
    saveDialog.current?.close();
  }
  const totals = frozenInput
    ? summarize(
        {
          review: frozenInput.review,
          selected: frozenInput.selected,
        } as ProjectSnapshot,
        rows,
      )
    : null;
  const needsAcknowledgement =
    !!totals &&
    !!(
      totals.unresolved ||
      totals.failed ||
      totals.incomplete ||
      totals.unreviewed
    );
  return (
    <div className="project-actions surface">
      <div>
        <strong>
          {readOnly
            ? "Read-only project"
            : saved
              ? savedVersion === version
                ? "Saved on this device"
                : "Unsaved changes"
              : "Unsaved project"}
        </strong>
        <p>
          {readOnly
            ? "Another tab may be editing this project. Close it and reopen here to edit. You can still export or download a backup."
            : "Save your progress or export the changes you have approved."}
        </p>
      </div>
      <div className="action-group">
        <button
          className="button secondary"
          disabled={pending || working || readOnly}
          onClick={() =>
            saved ? void task(save) : saveDialog.current?.showModal()
          }
        >
          {saved ? "Save changes" : "Save project"}
        </button>
        <button
          className="button secondary"
          disabled={pending || working}
          onClick={() =>
            void task(async () => {
              const result = await prepare({
                type: "pack",
                input: input(),
              });
              if (result.type === "packed") {
                download(result.backup, "review-project.mdr.json");
                setStatus(
                  "Backup downloaded. This does not save the project in this browser.",
                );
              }
            })
          }
        >
          Download backup
        </button>
        <button
          className="button primary"
          disabled={pending || working}
          onClick={() => {
            setFrozenInput(input());
            setArtifact(null);
            setError("");
            setExportOptions({
              spreadsheetSafe: false,
              bom: false,
              includeText: false,
              acknowledge: false,
            });
            exportDialog.current?.showModal();
          }}
        >
          Export reviewed CSV
        </button>
        {saved && (
          <button
            className="text-button"
            disabled={pending || working || readOnly}
            onClick={() => deleteDialog.current?.showModal()}
          >
            Delete saved project
          </button>
        )}
      </div>
      {preparing && (
        <button className="text-button" onClick={() => client.current.cancel()}>
          Cancel preparation
        </button>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      <dialog
        ref={saveDialog}
        className="confirm-dialog"
        aria-labelledby="save-title"
      >
        <h2 id="save-title">Save this project on this device?</h2>
        <p>
          This stores the original file, selected columns, settings, findings,
          proposals and decisions in this browser profile. Other people using
          this profile may access them. Browser data can be cleared or evicted;
          keep a downloaded backup. Changes are saved only when you choose Save
          changes.
        </p>
        <div className="dialog-actions">
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => saveDialog.current?.close()}
          >
            Not now
          </button>
          <button
            className="button primary"
            disabled={pending}
            onClick={() => void task(save)}
          >
            Save on this device
          </button>
        </div>
        {preparing && (
          <button
            className="button secondary"
            onClick={() => client.current.cancel()}
          >
            Cancel preparation
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </dialog>
      <dialog
        ref={deleteDialog}
        className="confirm-dialog"
        aria-labelledby="delete-title"
      >
        <h2 id="delete-title">Delete the saved project?</h2>
        <p>
          This removes its record from this browser. The current work stays open
          in memory. Downloaded backups and source files are separate copies and
          remain on your device.
        </p>
        <div className="dialog-actions">
          <button
            className="button secondary"
            onClick={() => deleteDialog.current?.close()}
          >
            Keep saved project
          </button>
          <button
            className="button primary"
            disabled={pending}
            onClick={() =>
              void task(async () => {
                if (!saved || !lease.current) return;
                await writeProject(
                  saved.snapshot,
                  lease.current,
                  saved.revision,
                  true,
                );
                lease.current.release();
                lease.current = null;
                setSaved(null);
                setSavedVersion(-1);
                setStatus(
                  "Saved project deleted. The open project is now unsaved.",
                );
                deleteDialog.current?.close();
              })
            }
          >
            Delete from this browser
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </dialog>
      <dialog
        ref={exportDialog}
        className="cell-dialog export-dialog"
        aria-labelledby="export-title"
      >
        <div className="dialog-heading">
          <h2 id="export-title">Export your review</h2>
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => exportDialog.current?.close()}
          >
            Close
          </button>
        </div>
        {totals && (
          <>
            <p>
              All {rows.toLocaleString()} rows will be exported in their
              original order, regardless of the current review filter.
            </p>
            <dl className="export-counts">
              <div>
                <dt>Approved changes</dt>
                <dd>{totals.changed}</dd>
              </div>
              <div>
                <dt>Unresolved findings</dt>
                <dd>{totals.unresolved}</dd>
              </div>
              <div>
                <dt>Failed inspections</dt>
                <dd>{totals.failed}</dd>
              </div>
              <div>
                <dt>Not inspected</dt>
                <dd>{totals.incomplete}</dd>
              </div>
              <div>
                <dt>Unreviewed cells</dt>
                <dd>{totals.unreviewed}</dd>
              </div>
            </dl>
          </>
        )}
        <p>
          Only approved proposals replace originals, including approved manual
          replacements. Original findings remain in the report. Other values
          stay unchanged. This is not a claim that every value is Unicode.
        </p>
        <fieldset disabled={pending || !!artifact}>
          <legend>CSV format</legend>
          <label>
            <input
              type="radio"
              name="csv-mode"
              checked={!exportOptions.spreadsheetSafe}
              onChange={() =>
                setExportOptions({ ...exportOptions, spreadsheetSafe: false })
              }
            />{" "}
            Preserve data values
          </label>
          <label>
            <input
              type="radio"
              name="csv-mode"
              checked={exportOptions.spreadsheetSafe}
              onChange={() =>
                setExportOptions({ ...exportOptions, spreadsheetSafe: true })
              }
            />{" "}
            Spreadsheet-safe escaping
          </label>
          <p>
            Spreadsheet-safe escaping adds an apostrophe to values that start
            with formula characters (including after whitespace), tabs or
            newlines. It also checks headers. This changes those values; their
            positions appear in the report. Spreadsheet behavior varies, and
            re-saving can remove protection.
          </p>
          <label>
            <input
              type="checkbox"
              checked={exportOptions.bom}
              onChange={(e) =>
                setExportOptions({ ...exportOptions, bom: e.target.checked })
              }
            />{" "}
            Include UTF-8 BOM
          </label>
          <label>
            <input
              type="checkbox"
              checked={exportOptions.includeText}
              onChange={(e) =>
                setExportOptions({
                  ...exportOptions,
                  includeText: e.target.checked,
                })
              }
            />{" "}
            Include original and replacement text for applied changes in the
            report
          </label>
          <p>
            The original separator and column names are preserved. CSV
            formatting may differ; values and embedded line breaks are kept. Use
            Download original for an identical copy of the source file.
          </p>
          {needsAcknowledgement && (
            <label className="export-ack">
              <input
                type="checkbox"
                checked={exportOptions.acknowledge}
                onChange={(e) =>
                  setExportOptions({
                    ...exportOptions,
                    acknowledge: e.target.checked,
                  })
                }
              />{" "}
              I understand that unresolved, failed or unreviewed cells remain,
              and approved manual replacements retain their original findings.
            </label>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {preparing && (
          <button
            className="button secondary"
            onClick={() => client.current.cancel()}
          >
            Cancel preparation
          </button>
        )}
        {!artifact ? (
          <button
            className="button primary"
            disabled={
              pending || (needsAcknowledgement && !exportOptions.acknowledge)
            }
            onClick={() =>
              void task(async () => {
                if (!frozenInput) return;
                const result = await prepare({
                  type: "export",
                  input: frozenInput,
                  options: exportOptions,
                });
                if (result.type === "exported")
                  setArtifact({
                    csv: result.csv,
                    report: result.report,
                    escaped: result.summary.escaped,
                  });
              })
            }
          >
            {pending ? "Preparing…" : "Prepare export"}
          </button>
        ) : (
          <>
            <p>
              {artifact.escaped.length} values received spreadsheet escaping.
              The report lists every affected row and column.
            </p>
            {artifact.escaped.length > 0 && (
              <details>
                <summary>See affected values</summary>
                <ul>
                  {artifact.escaped.slice(0, 25).map((item) => (
                    <li key={`${item.row}:${item.column}`}>
                      {item.header ? "Header" : `Row ${item.row}`} · Column{" "}
                      {item.column}
                    </li>
                  ))}
                </ul>
                {artifact.escaped.length > 25 && (
                  <p>
                    Showing the first 25 positions. Download the report for the
                    complete list.
                  </p>
                )}
              </details>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => download(artifact.report, "review-report.json")}
              >
                Download report
              </button>
              <button
                className="button primary"
                onClick={() =>
                  download(
                    artifact.csv,
                    exportOptions.spreadsheetSafe
                      ? "reviewed-spreadsheet.csv"
                      : "reviewed.csv",
                  )
                }
              >
                Download CSV
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
