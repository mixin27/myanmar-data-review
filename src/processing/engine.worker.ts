/// <reference lib="webworker" />
import { ApplicationInputError } from "@myanlex/application";
import { isWorkerRequest } from "./contracts";
import type { WorkerResponse } from "./contracts";
import { executeLocal } from "./execute";

const scope = self as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isWorkerRequest(request)) {
    // Invalid envelopes are never interpreted as processing requests.
    scope.postMessage({
      protocol: 1,
      id: -1,
      revision: -1,
      ok: false,
      error: { code: "invalid_request", message: "Invalid local request." },
    });
    return;
  }
  const envelope = {
    protocol: 1 as const,
    id: request.id,
    revision: request.revision,
  };
  let response: WorkerResponse;
  try {
    response = { ...envelope, ok: true, result: executeLocal(request.input) };
  } catch (error) {
    response = {
      ...envelope,
      ok: false,
      error:
        error instanceof ApplicationInputError
          ? { code: error.code, message: error.message }
          : {
              code: "local_failure",
              message:
                "Local processing failed. Run again to start a fresh worker.",
            },
    };
  }
  scope.postMessage(response);
};
