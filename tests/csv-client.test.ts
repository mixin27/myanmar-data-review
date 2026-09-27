import { afterEach, expect, it, vi } from "vitest";
import { CsvSession } from "../src/csv/client";
import type { CsvWorkerPort } from "../src/csv/client";
import type { CsvRequest, CsvResponse, CsvSummary } from "../src/csv/contracts";
class Port implements CsvWorkerPort {
  onmessage: CsvWorkerPort["onmessage"] = null;
  onerror: CsvWorkerPort["onerror"] = null;
  onmessageerror: CsvWorkerPort["onmessageerror"] = null;
  terminate = vi.fn();
  postMessage = vi.fn<(value: CsvRequest) => void>();
  respond(type: "ready" | "page" | "progress" | "error") {
    const request = this.postMessage.mock.lastCall![0];
    this.onmessage?.(
      new MessageEvent("message", {
        data: {
          id: request.id,
          session: request.session,
          type,
          summary: { id: request.session } as CsvSummary,
          page: { offset: 0, rows: [] },
          percent: 50,
          problem: { code: "invalid_utf8", message: "Invalid UTF-8" },
        } as CsvResponse,
      }),
    );
  }
}
const file = new File(["a,b"], "file.csv");
const options = { delimiter: "," as const, hasHeader: false };
afterEach(() => vi.useRealTimers());
it("retains the worker for pages then terminates on close", async () => {
  const port = new Port();
  const client = new CsvSession(() => port);
  const progress = vi.fn();
  const opened = client.open(file, options, "one", progress);
  port.respond("progress");
  expect(progress).toHaveBeenCalledWith(50);
  port.respond("ready");
  await opened;
  expect(port.terminate).not.toHaveBeenCalled();
  const page = client.page(0);
  port.respond("page");
  expect(await page).toEqual({ offset: 0, rows: [] });
  client.close();
  expect(port.terminate).toHaveBeenCalledOnce();
});
it("cancels, suppresses old callbacks and restarts after option changes", async () => {
  const ports: Port[] = [];
  const client = new CsvSession(() => {
    const port = new Port();
    ports.push(port);
    return port;
  });
  const rejected = expect(
    client.open(file, options, "one"),
  ).rejects.toMatchObject({ problem: { code: "superseded" } });
  const old = ports[0]!.onmessage!;
  const fresh = client.open(file, options, "two");
  await rejected;
  old(
    new MessageEvent("message", {
      data: {
        id: 1,
        session: "one",
        type: "ready",
        summary: { id: "old" },
      } as CsvResponse,
    }),
  );
  ports[1]!.respond("ready");
  expect((await fresh).id).toBe("two");
  client.close();
});
it("times out a stuck import and permits explicit recovery", async () => {
  vi.useFakeTimers();
  const port = new Port();
  const client = new CsvSession(() => port, 100);
  const rejection = expect(
    client.open(file, options, "one"),
  ).rejects.toMatchObject({ problem: { code: "timeout" } });
  await vi.advanceTimersByTimeAsync(101);
  await rejection;
  expect(port.terminate).toHaveBeenCalledOnce();
  const recovery = client.open(file, options, "two");
  port.respond("ready");
  await recovery;
  client.close();
});
it.each(["onerror", "onmessageerror"] as const)(
  "discards failed imports on %s",
  async (type) => {
    const port = new Port();
    const client = new CsvSession(() => port);
    const rejection = expect(
      client.open(file, options, "one"),
    ).rejects.toMatchObject({ problem: { code: "worker_failed" } });
    if (type === "onerror") port.onerror?.({} as ErrorEvent);
    else port.onmessageerror?.({} as MessageEvent);
    await rejection;
    expect(port.terminate).toHaveBeenCalledOnce();
  },
);
it("discards parsed state on validation errors and rejects unavailable pages", async () => {
  const port = new Port();
  const client = new CsvSession(() => port);
  const rejection = expect(
    client.open(file, options, "one"),
  ).rejects.toMatchObject({ problem: { code: "invalid_utf8" } });
  port.respond("error");
  await rejection;
  expect(port.terminate).toHaveBeenCalledOnce();
  await expect(client.page(0)).rejects.toMatchObject({
    problem: { code: "busy" },
  });
});
