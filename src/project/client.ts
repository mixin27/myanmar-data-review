import type { ProjectJob, ProjectResult } from "./contracts";
export class ProjectClient {
  private active: {
    worker: Worker;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private id = 0;
  cancel() {
    const active = this.active;
    if (!active) return;
    this.active = null;
    clearTimeout(active.timer);
    active.worker.terminate();
    active.reject(new Error("Cancelled. No project changes were saved."));
  }
  run(job: ProjectJob): Promise<ProjectResult> {
    this.cancel();
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./project.worker.ts", import.meta.url),
        { type: "module", name: "myanmar-project-files" },
      );
      const finish = () => {
        if (this.active?.worker === worker) this.active = null;
        clearTimeout(active.timer);
        worker.terminate();
      };
      const active = {
        worker,
        reject,
        timer: setTimeout(() => {
          finish();
          reject(
            new Error("This operation took too long. Try a smaller project."),
          );
        }, 30000),
      };
      this.active = active;
      worker.onerror = worker.onmessageerror = () => {
        finish();
        reject(new Error("This operation stopped unexpectedly. Try again."));
      };
      worker.onmessage = ({ data }) => {
        if (this.active !== active || data.id !== id) return;
        finish();
        if (data.error) reject(new Error(data.error));
        else resolve(data.result as ProjectResult);
      };
      try {
        worker.postMessage({ id, job });
      } catch (cause) {
        finish();
        reject(new Error("This project could not be prepared.", { cause }));
      }
    });
  }
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
