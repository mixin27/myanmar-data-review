/// <reference lib="webworker" />
import { CsvError } from "./contracts";
import type { CsvRequest, CsvResponse } from "./contracts";
import { readCsv } from "./dataset";
import type { CsvDataset } from "./dataset";

const scope = self as DedicatedWorkerGlobalScope;
let dataset: CsvDataset | null = null;
scope.onmessage = async ({ data }: MessageEvent<CsvRequest>) => {
  if (
    !data ||
    !Number.isSafeInteger(data.id) ||
    typeof data.session !== "string"
  )
    return;
  const envelope = { id: data.id, session: data.session };
  const send = (response: CsvResponse) => scope.postMessage(response);
  try {
    if (data.type === "open") {
      dataset = null;
      dataset = await readCsv(
        data.file,
        data.options,
        data.session,
        (percent) => send({ ...envelope, type: "progress", percent }),
      );
      send({ ...envelope, type: "ready", summary: dataset.summary() });
    } else if (data.type === "page" && dataset?.id === data.session) {
      send({
        ...envelope,
        type: "page",
        page: dataset.page(data.offset, data.count),
      });
    } else
      throw new CsvError({
        code: "not_ready",
        message: "Choose your file again to continue.",
      });
  } catch (error) {
    dataset = null;
    send({
      ...envelope,
      type: "error",
      problem:
        error instanceof CsvError
          ? error.problem
          : {
              code: "read_failed",
              message: "We could not read this file. Choose it again to retry.",
            },
    });
  }
};
