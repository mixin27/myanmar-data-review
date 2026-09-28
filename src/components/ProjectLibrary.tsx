import { useEffect, useRef, useState } from "react";
import { ProjectClient } from "../project/client";
import type { ProjectSnapshot } from "../project/contracts";
import { listProjects, loadProject } from "../project/storage";
import type { SavedProject, ProjectEntry } from "../project/storage";
export interface OpenedProject {
  snapshot: ProjectSnapshot;
  file: File;
  saved: SavedProject | null;
}
export function ProjectLibrary({
  onOpen,
  hasFile,
}: {
  onOpen: (project: OpenedProject) => Promise<void>;
  hasFile: boolean;
}) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [listed, setListed] = useState(false);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const client = useRef(new ProjectClient());
  const dialog = useRef<HTMLDialogElement>(null);
  const backup = useRef<HTMLInputElement>(null);
  useEffect(() => () => client.current.cancel(), []);
  async function restore(file: Blob, saved: SavedProject | null) {
    if (
      hasFile &&
      !window.confirm(
        "Opening this project closes the current work. Any changes since your last save will be lost. Continue?",
      )
    )
      return;
    setBusy(true);
    setPreparing(true);
    setError("");
    try {
      const result = await client.current.run({
        type: "restore",
        backup: file,
      });
      setPreparing(false);
      if (result.type === "restored") {
        await onOpen({ snapshot: result.snapshot, file: result.file, saved });
        dialog.current?.close();
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "This project could not be opened.",
      );
    } finally {
      setBusy(false);
      setPreparing(false);
    }
  }
  return (
    <>
      <button
        className="text-button"
        onClick={() => dialog.current?.showModal()}
      >
        Projects & backups
      </button>
      <dialog
        ref={dialog}
        className="cell-dialog library-dialog"
        aria-labelledby="library-title"
      >
        <div className="dialog-heading">
          <h2 id="library-title">Your projects</h2>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        <p>
          Projects saved in this browser stay on this device. Open a backup as a
          new unsaved project; nothing runs or saves automatically.
        </p>
        <div className="action-group">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              void listProjects()
                .then((values) => {
                  setProjects(values);
                  setListed(true);
                })
                .catch(() =>
                  setError(
                    "Saved projects could not be read. Try opening a downloaded backup.",
                  ),
                );
            }}
          >
            Show saved projects
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => backup.current?.click()}
          >
            Open backup
          </button>
        </div>
        <input
          ref={backup}
          className="sr-only"
          type="file"
          accept=".json"
          aria-label="Choose project backup"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void restore(file, null);
            event.target.value = "";
          }}
        />
        {listed && projects.length === 0 && (
          <p>No projects saved in this browser yet.</p>
        )}
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <div>
                <strong>{project.name}</strong>
                <p>Saved {new Date(project.updatedAt).toLocaleString()}</p>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setError("");
                  void loadProject(project.id)
                    .then((saved) =>
                      restore(
                        new Blob([JSON.stringify(saved.snapshot)], {
                          type: "application/json",
                        }),
                        saved,
                      ),
                    )
                    .catch((error) =>
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Could not open project.",
                      ),
                    );
                }}
              >
                Open saved project
              </button>
            </li>
          ))}
        </ul>
        {busy && (
          <>
            <p role="status">Opening project…</p>
            {preparing && (
              <button
                className="button secondary"
                onClick={() => client.current.cancel()}
              >
                Stop opening
              </button>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </dialog>
    </>
  );
}
