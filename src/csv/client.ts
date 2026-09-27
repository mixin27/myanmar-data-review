import { CsvError } from "./contracts";
import type {
  CsvOptions,
  CsvPage,
  CsvRequest,
  CsvResponse,
  CsvSummary,
} from "./contracts";
export interface CsvWorkerPort {
  onmessage: ((event: MessageEvent<CsvResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: CsvRequest): void;
  terminate(): void;
}
interface Pending {
  id: number;
  resolve: (value: CsvResponse) => void;
  reject: (error: CsvError) => void;
  timer: ReturnType<typeof setTimeout>;
  progress: (percent: number) => void;
}
export class CsvSession {
  private worker: CsvWorkerPort | null = null;
  private pending: Pending | null = null;
  private nextId = 0;
  private session = "";
  constructor(
    private readonly factory: () => CsvWorkerPort,
    private readonly timeoutMs = 30_000,
  ) {}
  close(
    code = "cancelled",
    message = "Opening cancelled. Your file has not been changed.",
  ): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new CsvError({ code, message }));
    }
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }
  async open(
    file: File,
    options: CsvOptions,
    session: string,
    progress: (percent: number) => void = () => {},
  ): Promise<CsvSummary> {
    this.close("superseded");
    this.session = session;
    try {
      this.worker = this.factory();
    } catch {
      throw new CsvError({
        code: "worker_failed",
        message: "We could not open this file. Try again.",
      });
    }
    const worker = this.worker;
    const fail = () => {
      if (this.worker === worker)
        this.close(
          "worker_failed",
          "Opening stopped unexpectedly. Choose the file again to retry.",
        );
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = ({ data }) => {
      if (
        this.worker !== worker ||
        !this.pending ||
        data?.session !== this.session ||
        data.id !== this.pending.id
      )
        return;
      if (data.type === "progress") {
        this.pending.progress(data.percent);
        return;
      }
      const pending = this.pending;
      if (!["ready", "page", "error"].includes(data.type)) {
        fail();
        return;
      }
      this.pending = null;
      clearTimeout(pending.timer);
      if (data.type === "error") {
        pending.reject(new CsvError(data.problem));
        this.close();
      } else pending.resolve(data);
    };
    const response = await this.send(
      { type: "open", file, options, session, id: ++this.nextId },
      progress,
    );
    if (response.type !== "ready") {
      this.close();
      throw new CsvError({
        code: "invalid_response",
        message: "We could not open this file. Try again.",
      });
    }
    return response.summary;
  }
  async page(offset: number, count = 25): Promise<CsvPage> {
    const response = await this.send({
      type: "page",
      offset,
      count,
      session: this.session,
      id: ++this.nextId,
    });
    if (response.type !== "page")
      throw new CsvError({
        code: "invalid_response",
        message: "We could not show this page. Choose the file again.",
      });
    return response.page;
  }
  private send(
    message: CsvRequest,
    progress: (percent: number) => void = () => {},
  ): Promise<CsvResponse> {
    if (!this.worker || this.pending)
      return Promise.reject(
        new CsvError({
          code: "busy",
          message: "Please wait for the file to finish opening.",
        }),
      );
    return new Promise((resolve, reject) => {
      this.pending = {
        id: message.id,
        resolve,
        reject,
        progress,
        timer: setTimeout(
          () =>
            this.close(
              "timeout",
              "This file took too long to open. Try again or choose a smaller file.",
            ),
          this.timeoutMs,
        ),
      };
      try {
        this.worker!.postMessage(message);
      } catch {
        this.close(
          "worker_failed",
          "We could not read this file. Choose it again to retry.",
        );
      }
    });
  }
}
