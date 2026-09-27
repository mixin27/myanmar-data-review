import { CsvSession } from "./client";
export const createCsvSession = () =>
  new CsvSession(
    () =>
      new Worker(new URL("./import.worker.ts", import.meta.url), {
        type: "module",
        name: "csv-import",
      }),
  );
