import type { ProjectSnapshot } from "./contracts";
export interface SavedProject {
  id: string;
  revision: number;
  updatedAt: string;
  snapshot: ProjectSnapshot;
}
export interface ProjectEntry {
  id: string;
  revision: number;
  updatedAt: string;
  name: string;
}
export interface WriterLease {
  readonly id: string;
  readonly writable: boolean;
  release(): void;
}
export async function acquireWriter(id: string): Promise<WriterLease> {
  if (!navigator.locks) return { id, writable: false, release() {} };
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(`myanmar-review:${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve({ id, writable: false, release() {} });
          return;
        }
        let held = true;
        await new Promise<void>((unlock) =>
          resolve({
            id,
            get writable() {
              return held;
            },
            release() {
              held = false;
              unlock();
            },
          }),
        );
      })
      .catch(reject);
  });
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("myanmar-review-projects", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects"))
        db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("summaries")) {
        const summaries = db.createObjectStore("summaries", { keyPath: "id" });
        const cursor = request
          .transaction!.objectStore("projects")
          .openCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current) return;
          const value = current.value as SavedProject;
          summaries.put({
            id: value.id,
            revision: value.revision,
            updatedAt: value.updatedAt,
            name: value.snapshot.sourceName,
          });
          current.continue();
        };
      }
    };
    request.onerror = () =>
      reject(
        new Error(
          "Device storage is unavailable or uses a newer version. Download a backup instead.",
        ),
      );
    request.onblocked = () =>
      reject(new Error("Close other tabs using this app, then try again."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
export async function listProjects(): Promise<ProjectEntry[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("summaries", "readonly");
      const request = tx.objectStore("summaries").getAll();
      tx.oncomplete = () => resolve(request.result as ProjectEntry[]);
      tx.onabort = tx.onerror = () =>
        reject(new Error("Saved projects could not be read."));
    });
  } finally {
    db.close();
  }
}
export async function writeProject(
  snapshot: ProjectSnapshot,
  lease: WriterLease,
  expected: number,
  remove = false,
): Promise<SavedProject> {
  if (!lease.writable)
    throw new Error(
      "This project is read-only because another tab is editing it.",
    );
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["projects", "summaries"], "readwrite");
      const store = tx.objectStore("projects");
      const result: SavedProject = {
        id: lease.id,
        revision: expected + 1,
        updatedAt: new Date().toISOString(),
        snapshot,
      };
      let conflict = false;
      const request = store.get(lease.id);
      request.onsuccess = () => {
        const existing = request.result as SavedProject | undefined;
        if ((existing?.revision ?? 0) !== expected) {
          conflict = true;
          tx.abort();
          return;
        }
        try {
          if (remove) {
            store.delete(lease.id);
            tx.objectStore("summaries").delete(lease.id);
          } else {
            store.put(result);
            tx.objectStore("summaries").put({
              id: result.id,
              revision: result.revision,
              updatedAt: result.updatedAt,
              name: snapshot.sourceName,
            });
          }
        } catch {
          try {
            tx.abort();
          } catch {
            /* already aborted */
          }
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            conflict
              ? "This saved project changed in another tab. Reopen it before saving."
              : "The project was not saved. Storage may be full or unavailable; download a backup. Your previous save is unchanged.",
          ),
        );
    });
  } finally {
    db.close();
  }
}

export async function loadProject(id: string): Promise<SavedProject> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readonly");
      const request = tx.objectStore("projects").get(id);
      tx.oncomplete = () =>
        request.result
          ? resolve(request.result as SavedProject)
          : reject(
              new Error(
                "This saved project was deleted. Refresh the project list.",
              ),
            );
      tx.onerror = tx.onabort = () =>
        reject(new Error("The saved project could not be read."));
    });
  } finally {
    db.close();
  }
}
