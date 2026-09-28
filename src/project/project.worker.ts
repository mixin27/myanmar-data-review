/// <reference lib="webworker" />
import { BACKUP_LIMIT } from "./contracts";
import type { ProjectJob, ProjectResult } from "./contracts";
import { pack, parseBackup, validateSnapshot } from "./snapshot";
import { exportProject } from "./export";
const scope = self as DedicatedWorkerGlobalScope;
scope.onmessage = async ({
  data,
}: MessageEvent<{ id: number; job: ProjectJob }>) => {
  try {
    let result: ProjectResult;
    if (data.job.type === "restore") {
      if (data.job.backup.size > BACKUP_LIMIT)
        throw new Error("Choose a project backup smaller than 96 MB.");
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        await data.job.backup.arrayBuffer(),
      );
      const { snapshot, file } = await validateSnapshot(parseBackup(decoded));
      result = { type: "restored", snapshot, file };
    } else {
      const packed = await pack(data.job.input);
      if (data.job.type === "pack")
        result = {
          type: "packed",
          snapshot: packed.snapshot,
          backup: packed.backup,
        };
      else {
        result = {
          type: "exported",
          ...exportProject(packed.snapshot, packed.dataset, data.job.options),
        };
      }
    }
    scope.postMessage({ id: data.id, result });
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error:
        error instanceof Error
          ? error.message
          : "This project could not be opened or prepared.",
    });
  }
};
