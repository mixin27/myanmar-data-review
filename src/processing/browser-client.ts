import { LocalWorkerClient } from "./worker-client";

export function createLocalWorkerClient(): LocalWorkerClient {
  return new LocalWorkerClient(
    () =>
      new Worker(new URL("./engine.worker.ts", import.meta.url), {
        type: "module",
        name: "myanmar-local-processing",
      }),
  );
}
