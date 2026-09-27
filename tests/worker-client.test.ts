import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalWorkerClient } from "../src/processing/worker-client";
import type { WorkerPort } from "../src/processing/worker-client";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../src/processing/contracts";
import { executeLocal } from "../src/processing/execute";

const input = {
  text: "hello 😀",
  convertToUnicode: false,
  normalizeNfc: false,
};
class FakeWorker implements WorkerPort {
  onmessage: WorkerPort["onmessage"] = null;
  onerror: WorkerPort["onerror"] = null;
  onmessageerror: WorkerPort["onmessageerror"] = null;
  terminate = vi.fn();
  postMessage = vi.fn<(request: WorkerRequest) => void>();
  respond(overrides: Partial<WorkerRequest> = {}) {
    const request = this.postMessage.mock.calls[0]![0];
    this.onmessage?.(
      new MessageEvent("message", {
        data: {
          ...request,
          ...overrides,
          ok: true,
          result: executeLocal(request.input),
        },
      }),
    );
  }
}
function setup() {
  const workers: FakeWorker[] = [];
  const client = new LocalWorkerClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, 100);
  return { client, workers };
}
afterEach(() => vi.useRealTimers());
describe("worker lifecycle", () => {
  it("resolves matching revisions and releases the worker", async () => {
    const { client, workers } = setup();
    const pending = client.execute(input, 2);
    workers[0]!.respond();
    expect(await pending).toEqual(executeLocal(input));
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(workers[0]!.onmessage).toBeNull();
  });
  it("terminates on cancel and supports a new run", async () => {
    const { client, workers } = setup();
    const pending = client.execute(input, 0);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    client.cancel();
    await rejected;
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    const next = client.execute(input, 1);
    workers[1]!.respond();
    await next;
  });
  it("times out without retry and recovers on explicit run", async () => {
    vi.useFakeTimers();
    const { client, workers } = setup();
    const rejected = expect(client.execute(input, 0)).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    const next = client.execute(input, 1);
    workers[1]!.respond();
    await next;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores an old worker callback and mismatched response identities", async () => {
    const { client, workers } = setup();
    const old = expect(client.execute(input, 0)).rejects.toMatchObject({
      code: "superseded",
    });
    const staleHandler = workers[0]!.onmessage!;
    const next = client.execute(input, 1);
    await old;
    const resolved = vi.fn();
    void next.then(resolved);
    staleHandler({
      data: {
        protocol: 1,
        id: 1,
        revision: 0,
        ok: true,
        result: executeLocal(input),
      },
    } as MessageEvent<WorkerResponse>);
    workers[1]!.respond({ revision: 0 });
    workers[1]!.respond({ id: 1 });
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    workers[1]!.respond();
    await next;
  });
  it.each(["onerror", "onmessageerror"] as const)(
    "recovers from %s without fallback",
    async (event) => {
      const { client, workers } = setup();
      const rejected = expect(client.execute(input, 0)).rejects.toMatchObject({
        code: "worker_failure",
      });
      if (event === "onerror") workers[0]!.onerror?.({} as ErrorEvent);
      else workers[0]!.onmessageerror?.({} as MessageEvent);
      await rejected;
      const next = client.execute(input, 1);
      workers[1]!.respond();
      await next;
    },
  );
  it("rejects startup and postMessage failures", async () => {
    await expect(
      new LocalWorkerClient(() => {
        throw new Error("blocked");
      }).execute(input, 0),
    ).rejects.toMatchObject({ code: "worker_failure" });
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error("clone");
    });
    await expect(
      new LocalWorkerClient(() => worker).execute(input, 0),
    ).rejects.toMatchObject({ code: "worker_failure" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("reports application errors as failures and malformed responses as worker failures", async () => {
    const { client, workers } = setup();
    const rejected = expect(client.execute(input, 0)).rejects.toMatchObject({
      code: "invalid_unicode",
    });
    workers[0]!.onmessage?.({
      data: {
        protocol: 1,
        id: 1,
        revision: 0,
        ok: false,
        error: { code: "invalid_unicode", message: "Invalid Unicode." },
      },
    } as MessageEvent<WorkerResponse>);
    await rejected;
    const malformed = expect(client.execute(input, 1)).rejects.toMatchObject({
      code: "worker_failure",
    });
    workers[1]!.onmessage?.({
      data: null,
    } as unknown as MessageEvent<WorkerResponse>);
    await malformed;
  });
});
