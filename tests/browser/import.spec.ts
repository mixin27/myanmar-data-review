import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const csv =
  'Customer ID,Customer name,Notes,City\r\n0012,မြန်မာ,"Called, awaiting reply",Yangon\r\n0013,မင်္ဂလာပါ,"First line\r\nSecond line",Mandalay\r\n0014,,"=SUM(A1)",Bago\r\n';
const choose = (page: Page, body = csv, name = "customers.csv") =>
  page
    .getByLabel("Choose CSV file", { exact: true })
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(body) });
const layout = (page: Page) =>
  page.getByRole("button", { name: "Use this layout" }).click();

test("guided import, explicit selection, original download, and user-facing copy", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Bring your Myanmar text",
  );
  await expect(page.locator("body")).not.toContainText(
    /Milestone|Integration|worker|engine|diagnostics/,
  );
  await choose(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Check your file’s layout",
  );
  await expect(
    page.getByRole("cell", { name: "0012", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Called, awaiting reply" }),
  ).toBeVisible();
  await layout(page);
  const open = page.getByRole("button", { name: "Open file", exact: true });
  await expect(open).toBeDisabled();
  await page.getByRole("checkbox", { name: "Column 2: Customer name" }).check();
  await page.getByRole("checkbox", { name: "Column 3: Notes" }).check();
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "customers.csv",
  );
  await expect(page.getByText("2 columns chosen for review")).toBeVisible();
  await expect(page.getByRole("cell", { name: "=SUM(A1)" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("customers.csv");
  expect(await readFile((await saved.path())!)).toEqual(Buffer.from(csv));
  await page.getByRole("button", { name: "Change columns" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Column 2: Customer name" }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "Column 3: Notes" }).uncheck();
  await page.getByRole("button", { name: "Save selection" }).click();
  await expect(page.getByText("1 column chosen for review")).toBeVisible();
  await page.getByRole("button", { name: "Open another file" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep this file" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "customers.csv",
  );
});

test("separator and header confirmation preserve duplicate and blank column names", async ({
  page,
}) => {
  await page.goto("/");
  await choose(
    page,
    "Name;;Name\n001;first;002\n003;second;004",
    "semicolon.csv",
  );
  await page.getByLabel("Values are separated by").selectOption(";");
  await layout(page);
  await page
    .getByRole("checkbox", { name: "Column 3: Name", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Column 1: Name", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Column 2: Column 2", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "001", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open another file" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Choose another file" })
    .click();
  await choose(page, "0001\tfirst\n0002\tsecond", "no-header.tsv");
  await page.getByLabel("Values are separated by").selectOption("\t");
  await page
    .getByRole("checkbox", { name: "First row contains column names" })
    .uncheck();
  await layout(page);
  await page.getByRole("checkbox", { name: "Column 1: Column 1" }).check();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "0001", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "0002", exact: true }),
  ).toBeVisible();
});

test("invalid UTF-8 and malformed records block import with useful recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([0x61, 0x0a, 0xc3, 0x28]),
  });
  await expect(page.getByRole("alert")).toContainText("not valid UTF-8");
  await expect(
    page.getByRole("button", { name: "Use this layout" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Choose another file", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Choose another file" })
    .click();
  await choose(page, 'a,b\n"first\nsecond",ok\nmissing');
  await expect(page.getByRole("alert")).toContainText("Record 3 · Line 4");
  await expect(
    page.getByRole("button", { name: "Use this layout" }),
  ).toBeDisabled();
});

test("cancelled imports cannot revive and an explicit retry recovers", async ({
  page,
}) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/import.worker-*.js", async (route) => {
    await wait;
    await route.continue();
  });
  await page.goto("/");
  await choose(page);
  await expect(page.getByText("Opening your file…")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use this layout" }),
  ).toBeDisabled();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("button", { name: "Use this layout" }),
  ).toBeEnabled();
});

test("local import does not upload or persist data and reload starts fresh", async ({
  page,
  context,
}) => {
  const violations: string[] = [];
  const requests: string[] = [];
  context.on("request", (request) => {
    if (
      ["fetch", "xhr", "websocket"].includes(request.resourceType()) ||
      request.method() !== "GET"
    )
      requests.push(request.url());
  });
  page.on("console", (message) => {
    if (message.text().includes("FORBIDDEN_IO"))
      violations.push(message.text());
  });
  const guard = `const deny=()=>{console.error('FORBIDDEN_IO');throw Error('FORBIDDEN_IO');};globalThis.fetch=deny;globalThis.XMLHttpRequest=deny;globalThis.WebSocket=deny;globalThis.indexedDB.open=deny;if(globalThis.Storage)globalThis.Storage.prototype.setItem=deny;if(globalThis.caches)globalThis.caches.open=deny;`;
  await page.addInitScript(guard);
  await page.route("**/import.worker-*.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `{${guard}}\n${await response.text()}`,
    });
  });
  await page.goto("/");
  await choose(page);
  await layout(page);
  await page.getByRole("checkbox", { name: "Column 2: Customer name" }).check();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "customers.csv",
  );
  expect(requests).toEqual([]);
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  expect(await context.cookies()).toEqual([]);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Bring your Myanmar text",
  );
});

test("large imports keep the table bounded and preserve values between pages", async ({
  page,
}) => {
  await page.goto("/");
  const rows = Array.from(
    { length: 50_000 },
    (_, i) => `${String(i).padStart(7, "0")},row ${i},text,001,😀`,
  );
  const start = performance.now();
  await choose(
    page,
    "ID,Name,Notes,Code,Symbol\n" + rows.join("\n"),
    "large.csv",
  );
  await layout(page);
  await page.getByRole("checkbox", { name: "Column 2: Name" }).check();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await expect(page.getByText("Rows 1–25 of 50,000")).toBeVisible();
  expect(await page.locator("tbody tr").count()).toBe(25);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(
    page.getByRole("cell", { name: "0000025", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(
    page.getByRole("cell", { name: "0000000", exact: true }),
  ).toBeVisible();
  console.log(
    `Chromium 50,000-row import and pagination: ${Math.round(performance.now() - start)} ms`,
  );
});

test("desktop and narrow layouts keep actions visible without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.screenshot({
    path: "test-results/import-desktop.png",
    fullPage: true,
  });
  await choose(page);
  await layout(page);
  await page.getByRole("checkbox", { name: "Column 2: Customer name" }).check();
  await page.screenshot({
    path: "test-results/columns-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "customers.csv",
  );
  await page.screenshot({
    path: "test-results/data-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Download original" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/data-narrow.png",
    fullPage: true,
  });
});
