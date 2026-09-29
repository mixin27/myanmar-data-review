import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import corpus from "../fixtures/detection-v1.json" with { type: "json" };
const sample = (id: string) => corpus.cases.find((c) => c.id === id)!.input;
async function openCsv(page: Page) {
  await page.goto("/");
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "project.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `ID,Text\n0001,${sample("strong-zawgyi")}\n0002,${sample("ambiguous-common-subset")}\n0003,=SUM(A1)`,
    ),
  });
  await page.getByRole("button", { name: "Use this layout" }).click();
  await page.getByRole("checkbox", { name: "Column 2: Text" }).check();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
}
async function review(page: Page) {
  await page
    .getByRole("button", { name: "Inspect selected text", exact: true })
    .click();
  await expect(
    page.getByText("Inspection complete.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Propose Unicode conversion").click();
  await page
    .getByRole("button", { name: "Start new review", exact: true })
    .click();
  await page.getByRole("button", { name: "Run inspection" }).click();
  await expect(
    page.getByText("Inspection complete.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Review queue").selectOption("changes");
  await page.getByRole("button", { name: "Approve eligible changes" }).click();
  await page.getByRole("button", { name: "Confirm approval" }).click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText("Saved on this device. Later changes", { exact: false }),
  ).toBeVisible();
}
async function library(page: Page) {
  await page.getByRole("button", { name: "Projects & backups" }).click();
  await page.getByRole("button", { name: "Show saved projects" }).click();
}
async function reopen(page: Page) {
  await library(page);
  await page
    .getByRole("button", { name: "Open saved project", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "project.csv",
  );
}
async function downloaded(page: Page, name: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const item = await pending;
  return readFile((await item.path())!);
}
test("exports approved changes and separate text-free report without saving automatically", async ({
  page,
}) => {
  const forbidden: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("PROJECT_FORBIDDEN_IO"))
      forbidden.push(message.text());
  });
  const guard = `const deny=()=>{console.error('PROJECT_FORBIDDEN_IO');throw Error('PROJECT_FORBIDDEN_IO');};globalThis.fetch=deny;globalThis.XMLHttpRequest=deny;globalThis.WebSocket=deny;globalThis.indexedDB.open=deny;if(globalThis.Storage)globalThis.Storage.prototype.setItem=deny;if(globalThis.caches)globalThis.caches.open=deny;if(globalThis.navigator.sendBeacon)globalThis.navigator.sendBeacon=deny;`;
  await page.addInitScript(guard);
  await page.route(
    /\/(project|engine|import)\.worker-.*\.js$/,
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: `{${guard}}\n${await response.text()}`,
      });
    },
  );
  await openCsv(page);
  await review(page);
  await page.getByRole("button", { name: "Export reviewed CSV" }).click();
  await expect(
    page.getByRole("button", { name: "Prepare export" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I understand that unresolved",
      exact: false,
    })
    .check();
  await page.getByRole("radio", { name: "Spreadsheet-safe escaping" }).check();
  await page.getByRole("button", { name: "Prepare export" }).click();
  const csv = (await downloaded(page, "Download CSV")).toString("utf8");
  expect(csv).toContain('"0001"');
  expect(csv).toContain('"\'=SUM(A1)"');
  expect(csv).not.toContain(sample("strong-zawgyi"));
  const reportText = (await downloaded(page, "Download report")).toString(
    "utf8",
  );
  const report = JSON.parse(reportText);
  expect(report.summary.changed).toBe(1);
  expect(report.summary.unresolved).toBe(1);
  expect(report.summary.escaped).toEqual([
    { row: 3, column: 2, header: false },
  ]);
  expect(reportText).not.toContain(sample("ambiguous-common-subset"));
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(forbidden).toEqual([]);
  await page.screenshot({ path: "test-results/export-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole("dialog");
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Download CSV", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/export-narrow.png" });
});
test("explicit saving restores approvals without processing and backup opens as a new unsaved project", async ({
  page,
  context,
}) => {
  await openCsv(page);
  await review(page);
  const backup = await downloaded(page, "Download backup");
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await save(page);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  const processing: string[] = [];
  page.on("worker", (worker) => {
    if (worker.url().includes("engine.worker")) processing.push(worker.url());
  });
  await reopen(page);
  expect(processing).toEqual([]);
  await page.getByLabel("Review queue").selectOption("approved");
  await expect(page.locator(".review-table tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Run inspection" }),
  ).toBeEnabled();
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "Projects & backups" }).click();
  await other.getByLabel("Choose project backup").setInputFiles({
    name: "copy.mdr.json",
    mimeType: "application/json",
    buffer: backup,
  });
  await expect(
    other.getByText("Unsaved project", { exact: true }),
  ).toBeVisible();
  await save(other);
  await other.getByRole("button", { name: "Projects & backups" }).click();
  await other.getByRole("button", { name: "Show saved projects" }).click();
  await expect(
    other.getByRole("button", { name: "Open saved project", exact: true }),
  ).toHaveCount(2);
});
test("another tab opens read-only; deletion is explicit and downloaded backups stay separate", async ({
  page,
  context,
}) => {
  await openCsv(page);
  await review(page);
  await save(page);
  const other = await context.newPage();
  await other.goto("/");
  await reopen(other);
  await expect(
    other.getByText("Read-only project", { exact: true }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: "Run inspection" }),
  ).toBeDisabled();
  await expect(
    other.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await expect(
    other.getByRole("button", { name: "Download backup", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Delete saved project", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete from this browser" }).click();
  await expect(
    page.getByText("Saved project deleted.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "project.csv",
  );
  await page.getByRole("button", { name: "Projects & backups" }).click();
  await page.getByRole("button", { name: "Show saved projects" }).click();
  await expect(
    page.getByRole("button", { name: "Open saved project", exact: true }),
  ).toHaveCount(0);
});
test("an aborted save preserves the previous checkpoint and reports recovery", async ({
  page,
}) => {
  await openCsv(page);
  await save(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      this.transaction.abort();
      IDBObjectStore.prototype.put = original;
      throw new DOMException("Simulated quota failure", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "previous save is unchanged",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await reopen(page);
  await expect(
    page.getByRole("button", { name: "Inspect selected text", exact: true }),
  ).toBeVisible();
});
test("invalid and newer backups fail without automatic storage or inspection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Projects & backups" }).click();
  await page.getByLabel("Choose project backup").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"myanmar-data-review","version":99}'),
  });
  await expect(page.getByRole("alert")).toContainText(
    "version is not supported",
  );
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test("stale checkpoint revisions are rejected instead of overwriting newer saves", async ({
  page,
}) => {
  await openCsv(page);
  await save(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("myanmar-review-projects", 2);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("projects", "readwrite");
        const store = tx.objectStore("projects");
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          if (cursor.result)
            cursor.result.update({
              ...cursor.result.value,
              revision: cursor.result.value.revision + 1,
            });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject();
      };
    });
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed in another tab");
});
test("schema migration keeps existing checkpoints, and newer schemas are not overwritten", async ({
  page,
}) => {
  await openCsv(page);
  const backup = JSON.parse(
    (await downloaded(page, "Download backup")).toString("utf8"),
  );
  await page.evaluate(async (snapshot) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("myanmar-review-projects", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("projects", { keyPath: "id" });
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("projects", "readwrite");
        tx.objectStore("projects").put({
          id: "legacy",
          revision: 1,
          updatedAt: new Date().toISOString(),
          snapshot,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject();
      };
    });
  }, backup);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await reopen(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "project.csv",
  );
  expect(
    await page.evaluate(async () => (await indexedDB.databases())[0]?.version),
  ).toBe(2);
  await page.reload();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("myanmar-review-projects", 99);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject();
    });
  });
  await library(page);
  await expect(page.getByRole("alert")).toContainText("could not be read");
  expect(
    await page.evaluate(async () => (await indexedDB.databases())[0]?.version),
  ).toBe(99);
});
test("backup work can be cancelled and restarted; failed worker startup is explicit", async ({
  page,
}) => {
  await openCsv(page);
  const backup = await downloaded(page, "Download backup");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "Projects & backups" }).click();
  await page.route("**/assets/project.worker-*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue().catch(() => {});
  });
  await page.getByLabel("Choose project backup").setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: backup,
  });
  await page.getByRole("button", { name: "Stop opening" }).click();
  await expect(page.getByRole("alert")).toContainText("Cancelled");
  await page.waitForTimeout(900);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Bring your Myanmar text",
  );
  await page.unroute("**/assets/project.worker-*.js");
  await page.route("**/assets/project.worker-*.js", (route) => route.abort());
  await page.getByLabel("Choose project backup").setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: backup,
  });
  await expect(page.getByRole("alert")).toContainText("stopped unexpectedly");
  await page.unroute("**/assets/project.worker-*.js");
  await page.getByLabel("Choose project backup").setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: backup,
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "project.csv",
  );
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test("project-file timeout releases the worker and explicit retry succeeds", async ({
  page,
}) => {
  await openCsv(page);
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    let first = true;
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 30000 && first) {
        first = false;
        return original(handler, 40, ...args);
      }
      return original(handler, delay, ...args);
    }) as typeof window.setTimeout;
  });
  await page.route("**/assets/project.worker-*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("took too long");
  await page.unroute("**/assets/project.worker-*.js");
  const backup = await downloaded(page, "Download backup");
  expect(JSON.parse(backup.toString("utf8")).format).toBe(
    "myanmar-data-review",
  );
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test("a blocked storage open closes its late connection and allows explicit retry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Projects & backups" }).click();
  await page.getByRole("button", { name: "Show saved projects" }).click();
  await expect(
    page.getByText("No projects saved in this browser yet."),
  ).toBeVisible();
  await page.evaluate(() => {
    const original = indexedDB.open.bind(indexedDB);
    const close = IDBDatabase.prototype.close;
    Object.assign(window, { lateClosed: false });
    IDBDatabase.prototype.close = function () {
      Object.assign(window, { lateClosed: true });
      return close.call(this);
    };
    indexedDB.open = (...args: Parameters<typeof indexedDB.open>) => {
      indexedDB.open = original;
      const request = original(...args);
      // Emulate an upgrade blocker disappearing after the UI has reported it.
      queueMicrotask(() => request.dispatchEvent(new Event("blocked")));
      return request;
    };
  });
  await page.getByRole("button", { name: "Show saved projects" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Saved projects could not be read",
  );
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "lateClosed")))
    .toBe(true);
  await page.getByRole("button", { name: "Show saved projects" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText("No projects saved in this browser yet."),
  ).toBeVisible();
});
