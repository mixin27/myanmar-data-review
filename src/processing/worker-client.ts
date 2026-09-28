import type {
  ProcessingInput,
  ProcessingResult,
  WorkerRequest,
  WorkerResponse,
} from "./contracts";

export interface WorkerPort {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export class LocalProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LocalProcessingError";
  }
}

interface ActiveRun {
  worker: WorkerPort;
  request: WorkerRequest;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: ProcessingResult) => void;
  reject: (error: LocalProcessingError) => void;
}

export class LocalWorkerClient {
  private active: ActiveRun | undefined;
  private nextId = 0;
  private reusableWorker: WorkerPort | undefined;
  constructor(
    private readonly factory: () => WorkerPort,
    private readonly timeoutMs = 30_000,
    private readonly reuseWorker = false,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 2_147_483_647
    ) {
      throw new RangeError("timeoutMs must be a positive timer-safe integer.");
    }
  }

  cancel(code = "cancelled"): void {
    const run = this.active;
    if (!run) {
      this.reusableWorker?.terminate();
      this.reusableWorker = undefined;
      return;
    }
    this.cleanup(run);
    run.reject(
      new LocalProcessingError(
        code,
        code === "timeout"
          ? "Local processing timed out. Run again to start a fresh worker."
          : "Local processing cancelled.",
      ),
    );
  }

  execute(input: ProcessingInput, revision: number): Promise<ProcessingResult> {
    if (this.active) this.cancel("superseded");
    if (!Number.isSafeInteger(revision) || revision < 0) {
      return Promise.reject(
        new LocalProcessingError("invalid_request", "Invalid revision."),
      );
    }
    const request: WorkerRequest = {
      protocol: 1,
      id: ++this.nextId,
      revision,
      input: { ...input },
    };
    return new Promise((resolve, reject) => {
      try {
        const worker = this.reusableWorker ?? this.factory();
        if (this.reuseWorker) this.reusableWorker = worker;
        const run: ActiveRun = {
          worker,
          request,
          resolve,
          reject,
          timer: setTimeout(() => {
            if (this.active === run) this.cancel("timeout");
          }, this.timeoutMs),
        };
        this.active = run;
        const failed = () => {
          if (this.active !== run) return;
          this.cleanup(run);
          reject(
            new LocalProcessingError(
              "worker_failure",
              "The local worker failed. Run again to recover.",
            ),
          );
        };
        worker.onerror = failed;
        worker.onmessageerror = failed;
        worker.onmessage = ({ data }) => {
          if (this.active !== run) return;
          if (!data || data.protocol !== 1 || typeof data.ok !== "boolean") {
            failed();
            return;
          }
          if (data.id !== request.id || data.revision !== request.revision)
            return;
          if (
            data.ok &&
            (!data.result || data.result.original !== request.input.text)
          ) {
            failed();
            return;
          }
          if (
            !data.ok &&
            (!data.error ||
              typeof data.error.code !== "string" ||
              typeof data.error.message !== "string")
          ) {
            failed();
            return;
          }
          this.cleanup(run, this.reuseWorker);
          if (data.ok) resolve(data.result);
          else
            reject(
              new LocalProcessingError(data.error.code, data.error.message),
            );
        };
        worker.postMessage(request);
      } catch {
        if (this.active) this.cleanup(this.active);
        reject(
          new LocalProcessingError(
            "worker_failure",
            "Unable to start the local worker. Run again to recover.",
          ),
        );
      }
    });
  }

  private cleanup(run: ActiveRun, keepWorker = false): void {
    if (this.active === run) this.active = undefined;
    clearTimeout(run.timer);
    run.worker.onmessage = null;
    run.worker.onerror = null;
    run.worker.onmessageerror = null;
    if (!keepWorker) {
      run.worker.terminate();
      this.reusableWorker = undefined;
    }
  }
}
