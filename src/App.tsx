import { ProjectLibrary } from "./components/ProjectLibrary";
import type { OpenedProject } from "./components/ProjectLibrary";
import { useEffect, useRef, useState } from "react";
import { createCsvSession } from "./csv/browser-client";
import { CSV_LIMITS, CsvError, columnLabel } from "./csv/contracts";
import type {
  CsvOptions,
  CsvPage,
  CsvProblem,
  CsvSummary,
  Delimiter,
} from "./csv/contracts";
import { DataTable } from "./components/DataTable";
import { Icon } from "./components/Icon";
import { ReviewPanel } from "./components/ReviewPanel";

const initialOptions: CsvOptions = { delimiter: ",", hasHeader: true };
const count = (value: number) => value.toLocaleString("en-US");
const fileSize = (value: number) =>
  value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;

export function App() {
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState<OpenedProject | null>(null);
  const [projectReadOnly, setProjectReadOnly] = useState(false);
  const [step, setStep] = useState<"file" | "layout" | "columns" | "data">(
    "file",
  );
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<CsvOptions>(initialOptions);
  const [summary, setSummary] = useState<CsvSummary | null>(null);
  const [page, setPage] = useState<CsvPage | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState<CsvProblem | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [reviewStarted, setReviewStarted] = useState(false);
  const session = useRef<ReturnType<typeof createCsvSession> | null>(null);
  const revision = useRef(0);
  const fileId = useRef("");
  const chooser = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    session.current = createCsvSession();
    return () => {
      revision.current++;
      session.current?.close();
      session.current = null;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    if (!file || !dirty) return;
    const beforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeLeave);
    return () => window.removeEventListener("beforeunload", beforeLeave);
  }, [file, dirty]);

  async function open(nextFile: File, nextOptions: CsvOptions, id: string) {
    const current = session.current;
    if (!current) return;
    const version = ++revision.current;
    setBusy(true);
    setProgress(0);
    setProblem(null);
    setSummary(null);
    setPage(null);
    setNotice("");
    try {
      const result = await current.open(
        nextFile,
        nextOptions,
        id,
        (percent) => {
          if (version === revision.current) setProgress(percent);
        },
      );
      if (version !== revision.current) return;
      setSummary(result);
      setPage(result.preview);
    } catch (error) {
      if (version !== revision.current) return;
      setProblem(
        error instanceof CsvError
          ? error.problem
          : {
              code: "read_failed",
              message: "We could not read this file. Choose it again to retry.",
            },
      );
    } finally {
      if (version === revision.current) setBusy(false);
    }
  }
  function choose(files: FileList | null) {
    if (!files?.length) return;
    if (files.length !== 1) {
      setProblem({
        code: "one_file",
        message: "Choose one CSV file at a time.",
      });
      return;
    }
    const next = files[0]!;
    if (next.size > CSV_LIMITS.maxFileBytes) {
      setProblem({
        code: "file_limit",
        message:
          "Choose a CSV smaller than 10 MB. You can split a larger file in your spreadsheet app.",
      });
      return;
    }
    const id = crypto.randomUUID();
    fileId.current = id;
    setRestored(null);
    setProjectReadOnly(false);
    setReviewStarted(false);
    setDirty(true);
    setFile(next);
    setOptions(initialOptions);
    setSelected(new Set());
    setDraft(new Set());
    setEditing(false);
    setStep("layout");
    void open(next, initialOptions, id);
  }
  function changeOptions(next: CsvOptions) {
    setOptions(next);
    setDraft(new Set());
    setSelected(new Set());
    if (file) void open(file, next, fileId.current);
  }
  function cancelOpen() {
    revision.current++;
    session.current?.close();
    setBusy(false);
    setSummary(null);
    setPage(null);
    setNotice("Opening cancelled. Your original file is unchanged.");
  }
  function reset() {
    revision.current++;
    session.current?.close();
    setRestored(null);
    setProjectReadOnly(false);
    setReviewStarted(false);
    setDirty(false);
    setFile(null);
    setSummary(null);
    setPage(null);
    setProblem(null);
    setSelected(new Set());
    setDraft(new Set());
    setBusy(false);
    setPaging(false);
    setSearch("");
    setNotice("");
    setStep("file");
    dialog.current?.close();
    if (chooser.current) chooser.current.value = "";
  }
  function toggle(id: string) {
    setDraft((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function finishSelection() {
    const current = session.current;
    if (!current || !draft.size) return;
    const version = revision.current;
    setPaging(true);
    setProblem(null);
    try {
      const firstPage = await current.page(0);
      if (version !== revision.current) return;
      setPage(firstPage);
      setSelected(new Set(draft));
      setStep("data");
      setEditing(false);
      setNotice(
        editing
          ? "Column selection updated. Original values are unchanged."
          : "File imported. Your original values are unchanged.",
      );
    } catch (error) {
      if (version === revision.current)
        setProblem(
          error instanceof CsvError
            ? error.problem
            : {
                code: "read_failed",
                message: "We could not open this file. Choose it again.",
              },
        );
    } finally {
      if (version === revision.current) setPaging(false);
    }
  }
  async function showPage(offset: number) {
    if (!session.current) return;
    const version = revision.current;
    setPaging(true);
    setProblem(null);
    try {
      const next = await session.current.page(offset);
      if (version === revision.current) setPage(next);
    } catch (error) {
      if (version === revision.current)
        setProblem(
          error instanceof CsvError
            ? error.problem
            : {
                code: "read_failed",
                message: "We could not show this page. Choose the file again.",
              },
        );
    } finally {
      if (version === revision.current) setPaging(false);
    }
  }
  async function restoreProject(project: OpenedProject) {
    const { snapshot, file: original } = project;
    setRestored(null);
    setProjectReadOnly(!!project.saved);
    setEditing(false);
    setDirty(!project.saved);
    setFile(original);
    setOptions(snapshot.options);
    fileId.current = snapshot.datasetId;
    setSelected(new Set(snapshot.selected));
    setDraft(new Set(snapshot.selected));
    setReviewStarted(!!snapshot.review);
    setStep("layout");
    await open(original, snapshot.options, snapshot.datasetId);
    const restoredPage = await session.current!.page(0);
    setPage(restoredPage);
    setRestored(project);
    setStep("data");
  }
  function downloadOriginal() {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const currentStep = step === "file" ? 0 : step === "layout" ? 1 : 2;
  const displayedColumns =
    summary?.columns.filter((column) =>
      `${columnLabel(column)} ${column.index + 1}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];

  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            if (file) dialog.current?.showModal();
          }}
          aria-label="Myanmar Data Review home"
        >
          <span className="brand-symbol" aria-hidden="true">
            မ
          </span>
          <span>
            Myanmar<span className="brand-light"> Data Review</span>
          </span>
        </a>
        <ProjectLibrary onOpen={restoreProject} hasFile={!!file} />
        <span className="privacy-badge">
          <Icon name="lock" size={15} />
          Only on your device
        </span>
      </header>
      <main className={`workspace ${step === "data" ? "wide-workspace" : ""}`}>
        {step !== "data" && (
          <nav aria-label="Import progress" className="steps">
            <ol>
              {["Choose file", "Check layout", "Choose columns"].map(
                (label, index) => (
                  <li
                    key={label}
                    aria-current={currentStep === index ? "step" : undefined}
                    className={
                      currentStep > index
                        ? "complete"
                        : currentStep === index
                          ? "current"
                          : ""
                    }
                  >
                    <span className="step-dot">
                      {currentStep > index ? (
                        <Icon name="check" size={14} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span>{label}</span>
                  </li>
                ),
              )}
            </ol>
          </nav>
        )}

        {step === "file" && (
          <section className="welcome">
            <div className="page-intro">
              <span className="eyebrow">A clearer start for your data</span>
              <h1 ref={heading} tabIndex={-1}>
                Bring your Myanmar text
                <br />
                into focus.
              </h1>
              <p>
                Open a CSV and choose the columns you want to review.
                <br className="desktop-break" /> Your original file stays
                untouched.
              </p>
            </div>
            <div
              className={`upload-panel ${dragging ? "dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                choose(event.dataTransfer.files);
              }}
            >
              <div className="upload-icon">
                <Icon name="upload" size={27} />
              </div>
              <h2>Start with your CSV</h2>
              <p>Drag a file here, or choose one from your device.</p>
              <button
                className="button primary"
                onClick={() => chooser.current?.click()}
              >
                <Icon name="file" size={18} />
                Choose CSV file
              </button>
              <span className="file-guidance">UTF-8 CSV · Up to 10 MB</span>
            </div>
            <div className="reassurance">
              <Icon name="lock" size={18} />
              <p>
                Your file stays in this browser. Nothing is uploaded or saved
                automatically.
              </p>
            </div>
            <details className="help-note">
              <summary>Need to prepare your file?</summary>
              <p>
                In your spreadsheet app, save a copy as{" "}
                <strong>CSV UTF-8</strong>. Commas, semicolons, and tabs are
                supported. Keep the original spreadsheet as your backup.
              </p>
            </details>
          </section>
        )}
        <input
          ref={chooser}
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose CSV file"
          onChange={(event) => choose(event.target.files)}
        />

        {step === "layout" && file && (
          <section>
            <div className="page-intro compact">
              <span className="eyebrow">Make sure everything lines up</span>
              <h1 ref={heading} tabIndex={-1}>
                Check your file’s layout
              </h1>
              <p>
                Choose how values are separated, then check the preview before
                continuing.
              </p>
            </div>
            <div className="file-banner">
              <span className="file-icon">
                <Icon name="file" />
              </span>
              <div>
                <strong>{file.name}</strong>
                <span>{fileSize(file.size)} · Original file</span>
              </div>
              <button
                className="text-button"
                onClick={() => dialog.current?.showModal()}
              >
                Choose another file
              </button>
            </div>
            <div className="surface">
              <div className="layout-controls">
                <label className="field-label" htmlFor="separator">
                  Values are separated by
                  <select
                    id="separator"
                    value={options.delimiter}
                    onChange={(event) =>
                      changeOptions({
                        ...options,
                        delimiter: event.target.value as Delimiter,
                      })
                    }
                  >
                    <option value=",">Comma (,)</option>
                    <option value=";">Semicolon (;)</option>
                    <option value={"\t"}>Tab</option>
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={options.hasHeader}
                    onChange={(event) =>
                      changeOptions({
                        ...options,
                        hasHeader: event.target.checked,
                      })
                    }
                  />
                  <span>
                    First row contains column names
                    <small>Turn this off if the first row is data.</small>
                  </span>
                </label>
              </div>
              {busy && (
                <div className="loading-panel" role="status">
                  <span className="spinner" />
                  <h2>Opening your file…</h2>
                  <p>Checking rows and keeping every original value.</p>
                  <progress
                    value={progress}
                    max={100}
                    aria-label="Opening file"
                  />
                  <button className="text-button" onClick={cancelOpen}>
                    Cancel
                  </button>
                </div>
              )}
              {!busy && summary && (
                <>
                  <div className="section-heading">
                    <h2>Preview</h2>
                    <span>
                      {count(summary.rowCount)} rows ·{" "}
                      {count(summary.columns.length)} columns
                    </span>
                  </div>
                  <DataTable
                    columns={summary.columns}
                    page={summary.preview}
                    selected={new Set()}
                    preview
                  />
                  <p className="table-note">
                    Showing the first {summary.preview.rows.length} data rows.
                    Long values are shortened in the preview.
                  </p>
                </>
              )}
              {!busy && !summary && !problem && (
                <div className="empty-panel">
                  <p>{notice || "Open the file to check its layout."}</p>
                  <button
                    className="button secondary"
                    onClick={() => void open(file, options, fileId.current)}
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
            <div className="action-bar">
              <span>Nothing in your file has been changed.</span>
              <button
                className="button primary"
                disabled={busy || !summary}
                onClick={() => {
                  setSearch("");
                  setStep("columns");
                }}
              >
                Use this layout
                <Icon name="arrow" size={18} />
              </button>
            </div>
          </section>
        )}

        {step === "columns" && summary && (
          <section>
            <div className="page-intro compact">
              <span className="eyebrow">You decide what gets reviewed</span>
              <h1 ref={heading} tabIndex={-1}>
                Choose your text columns
              </h1>
              <p>
                Select columns containing Myanmar text. Leave IDs, dates, and
                other values unselected.
              </p>
            </div>
            <div className="selection-layout">
              <div className="surface column-picker">
                <div className="section-heading">
                  <h2>
                    Columns in your file{" "}
                    <span className="count-badge">
                      {summary.columns.length}
                    </span>
                  </h2>
                  <span>{draft.size} selected</span>
                </div>
                {summary.columns.length > 8 && (
                  <div className="column-search">
                    <label htmlFor="column-search" className="sr-only">
                      Find a column
                    </label>
                    <input
                      id="column-search"
                      type="search"
                      placeholder="Find a column…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                )}
                <div className="column-list">
                  {displayedColumns.map((column) => (
                    <label
                      key={column.id}
                      className={`column-option ${draft.has(column.id) ? "is-selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={draft.has(column.id)}
                        onChange={() => toggle(column.id)}
                        aria-label={`Column ${column.index + 1}: ${columnLabel(column)}`}
                      />
                      <span className="column-copy">
                        <strong>{columnLabel(column)}</strong>
                        <small>
                          Column {column.index + 1}
                          <span aria-hidden="true"> · </span>
                          <span>
                            {summary.preview.rows
                              .map((row) => row.values[column.index])
                              .filter(Boolean)
                              .slice(0, 2)
                              .join(" · ")
                              .slice(0, 100) || "Empty in these preview rows"}
                          </span>
                        </small>
                      </span>
                      {draft.has(column.id) && (
                        <span className="selection-mark">
                          <Icon name="check" size={16} />
                        </span>
                      )}
                    </label>
                  ))}
                  {!displayedColumns.length && (
                    <p className="empty-panel">
                      No matching columns. Try another name.
                    </p>
                  )}
                </div>
              </div>
              <aside className="selection-note">
                <span className="note-icon">
                  <Icon name="check" size={22} />
                </span>
                <h2>A focused review</h2>
                <p>
                  Only the columns you choose will be included in your text
                  review.
                </p>
                <hr />
                <p>
                  All rows and columns stay in the file. Selecting a column does
                  not change its values.
                </p>
                <span className="mini-file">
                  <Icon name="file" size={16} />
                  {summary.name}
                </span>
              </aside>
            </div>
            <div className="action-bar">
              <button
                className="text-button"
                disabled={paging}
                onClick={() => setStep(editing ? "data" : "layout")}
              >
                <Icon name="back" size={16} />
                {editing ? "Cancel" : "Back to layout"}
              </button>
              <div className="action-group">
                <span>
                  {draft.size
                    ? `${draft.size} ${draft.size === 1 ? "column" : "columns"} selected`
                    : "Choose at least one column"}
                </span>
                <button
                  className="button primary"
                  disabled={!draft.size || paging}
                  onClick={() => void finishSelection()}
                >
                  {paging
                    ? "Opening…"
                    : editing
                      ? "Save selection"
                      : "Open file"}
                  <Icon name="arrow" size={18} />
                </button>
              </div>
            </div>
          </section>
        )}

        {step === "data" && summary && page && (
          <section>
            <div className="dataset-heading">
              <div>
                <span className="eyebrow">File ready for review</span>
                <h1 ref={heading} tabIndex={-1}>
                  {summary.name}
                </h1>
                <p>
                  {count(summary.rowCount)} rows
                  <span className="meta-dot">·</span>
                  {summary.columns.length} columns
                  <span className="meta-dot">·</span>
                  {fileSize(summary.bytes)}
                </p>
              </div>
              <div className="dataset-actions">
                <button className="button secondary" onClick={downloadOriginal}>
                  <Icon name="download" size={17} />
                  Download original
                </button>
                <button
                  className="text-button"
                  onClick={() => dialog.current?.showModal()}
                >
                  Open another file
                </button>
              </div>
            </div>
            <div className="selection-banner">
              <span className="selection-banner-icon">
                <Icon name="check" />
              </span>
              <div>
                <strong>
                  {selected.size}{" "}
                  {selected.size === 1 ? "column chosen" : "columns chosen"} for
                  review
                </strong>
                <p>
                  {summary.columns
                    .filter((column) => selected.has(column.id))
                    .map(columnLabel)
                    .join(", ")}
                </p>
              </div>
              <button
                className="text-button"
                disabled={paging || projectReadOnly}
                onClick={() => {
                  if (
                    reviewStarted &&
                    !window.confirm(
                      "Changing columns clears the current review, proposals and approvals. Continue?",
                    )
                  )
                    return;
                  setRestored(null);
                  setReviewStarted(false);
                  setDraft(new Set(selected));
                  setSearch("");
                  setEditing(true);
                  setStep("columns");
                }}
              >
                Change columns
              </button>
            </div>
            {file && (
              <ReviewPanel
                key={summary.id}
                file={file}
                options={options}
                summary={summary}
                selected={selected}
                onReviewStarted={() => setReviewStarted(true)}
                restored={restored}
                onProjectReadOnly={setProjectReadOnly}
                onDirty={setDirty}
              />
            )}
            <div className="surface data-surface">
              <div className="section-heading">
                <h2>Original data</h2>
                <span>Original values</span>
              </div>
              <div aria-busy={paging}>
                <DataTable
                  columns={summary.columns}
                  page={page}
                  selected={selected}
                />
              </div>
              <div className="pagination">
                <span>
                  Rows {count(page.offset + 1)}–
                  {count(page.offset + page.rows.length)} of{" "}
                  {count(summary.rowCount)}
                </span>
                <div>
                  <button
                    className="button page-button"
                    aria-label="Previous page"
                    disabled={paging || page.offset === 0}
                    onClick={() => void showPage(Math.max(0, page.offset - 25))}
                  >
                    <Icon name="back" size={17} />
                  </button>
                  <span>
                    Page {Math.floor(page.offset / 25) + 1} of{" "}
                    {Math.ceil(summary.rowCount / 25)}
                  </span>
                  <button
                    className="button page-button"
                    aria-label="Next page"
                    disabled={
                      paging ||
                      page.offset + page.rows.length >= summary.rowCount
                    }
                    onClick={() => void showPage(page.offset + 25)}
                  >
                    <Icon name="arrow" size={17} />
                  </button>
                </div>
              </div>
            </div>
            <p className="unsaved-note">
              <Icon name="lock" size={15} />
              Save changes explicitly to keep your progress. Download a backup
              before clearing browser data.
            </p>
          </section>
        )}
        {problem && (
          <div className="error-panel" role="alert">
            <strong>
              {summary
                ? "We couldn’t display this file"
                : "We couldn’t open this file"}
            </strong>
            <p>{problem.message}</p>
            {problem.record && (
              <p className="error-location">
                Record {problem.record}
                {problem.line ? ` · Line ${problem.line}` : ""}
                {problem.field ? ` · Field ${problem.field}` : ""}
              </p>
            )}
            {step === "layout" && (
              <p>
                Check the file layout above, or choose another file. No data has
                been imported.
              </p>
            )}
            {(step === "columns" || step === "data") && file && (
              <>
                <p>Your original file is unchanged. Reopen it to continue.</p>
                <button
                  className="button secondary"
                  onClick={() => {
                    setStep("layout");
                    void open(file, options, fileId.current);
                  }}
                >
                  Reopen file
                </button>
              </>
            )}
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">
          {!busy ? notice : ""}
        </div>
      </main>
      <footer className="app-footer">
        <span>Careful review. Original data preserved.</span>
        <details>
          <summary>Licenses</summary>
          <a href="/licenses/MyanLex-MIT.txt">MyanLex</a>
          <a href="/licenses/MyanLex-THIRD_PARTY_NOTICES.md">
            Third-party notices
          </a>
          <a href="/licenses/Apache-2.0.txt">Apache-2.0</a>
        </details>
      </footer>
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="discard-title"
      >
        <h2 id="discard-title">Open a different file?</h2>
        <p>
          This will close the file in this tab and clear your column selection.
          Your original file won’t be changed.
        </p>
        <div className="dialog-actions">
          <button
            className="button secondary"
            onClick={() => dialog.current?.close()}
          >
            Keep this file
          </button>
          <button className="button primary" onClick={reset}>
            Choose another file
          </button>
        </div>
      </dialog>
    </div>
  );
}
