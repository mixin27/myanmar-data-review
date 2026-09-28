import { LocalWorkerClient } from "./worker-client";

export function createLocalWorkerClient(
  reuseWorker = false,
): LocalWorkerClient {
  return new LocalWorkerClient(
    () =>
      new Worker(new URL("./engine.worker.ts", import.meta.url), {
        type: "module",
        name: "myanmar-local-processing",
      }),
    30_000,
    reuseWorker,
  );
}
