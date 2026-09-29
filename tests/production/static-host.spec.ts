import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import headers from "../../deployment/headers.json" with { type: "json" };

test("production assets carry security headers and appropriate cache policy", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  for (const [name, value] of Object.entries(headers))
    expect(response.headers()[name.toLowerCase()]).toBe(value);
  expect(response.headers()["cache-control"]).toBe("no-cache");
  const html = await response.text();
  const script = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
  expect(script).toBeTruthy();
  const asset = await request.get(script!);
  expect(asset.headers()["content-type"]).toContain("javascript");
  expect(asset.headers()["cache-control"]).toContain("immutable");
  expect(asset.headers()["content-security-policy"]).toBe(
    headers["Content-Security-Policy"],
  );
});

test("production CSP permits local review, export and explicit save without processing traffic", async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  const workers = new Set<string>();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("worker", (worker) => workers.add(worker.url()));
  const network: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      request.method() !== "GET" ||
      (!url.startsWith(`${baseURL}/`) && !url.startsWith(`blob:${baseURL}/`))
    )
      network.push(url);
  });
  await page.goto("/");
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "preview.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("ID,Text\n001,hello"),
  });
  await page.getByRole("button", { name: "Use this layout" }).click();
  await page.getByRole("checkbox", { name: "Column 2: Text" }).check();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect selected text", exact: true })
    .click();
  await expect(
    page.getByText("Inspection complete.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Export reviewed CSV" }).click();
  const acknowledge = page.getByRole("checkbox", {
    name: "I understand that unresolved",
    exact: false,
  });
  if (await acknowledge.isVisible()) await acknowledge.check();
  await page.getByRole("button", { name: "Prepare export" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const downloaded = await pending;
  expect(
    (await readFile((await downloaded.path())!)).toString("utf8"),
  ).toContain('"001","hello"');
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText("Saved on this device. Later changes", { exact: false }),
  ).toBeVisible();
  for (const name of ["import", "engine", "project"])
    expect([...workers].some((url) => url.includes(`${name}.worker-`))).toBe(
      true,
    );
  expect(network).toEqual([]);
  expect(errors).toEqual([]);
});

test("production policy blocks script-driven network connections", async ({
  page,
}) => {
  const attempted: string[] = [];
  await page.route("**/processing-probe", async (route) => {
    attempted.push(route.request().url());
    await route.fulfill({ status: 200, body: "unexpected" });
  });
  await page.goto("/");
  const blocked = await page.evaluate(async () => {
    try {
      await fetch("/processing-probe", { method: "POST", body: "synthetic" });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  expect(attempted).toEqual([]);
});
