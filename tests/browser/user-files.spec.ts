// Optional, local-only reproduction. The user's files are never copied into the
// repository, uploaded, included in screenshots, or treated as instructions.
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
const files: string[] = JSON.parse(process.env.MDR_LOCAL_CSV_FILES ?? "[]");
for (const [index, file] of files.entries()) {
  test(`local supplied CSV ${index + 1} imports and preserves a selected column`, async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByLabel("Choose CSV file", { exact: true })
      .setInputFiles(file);
    await page.getByRole("button", { name: "Use this layout" }).click();
    const selected = page.getByRole("checkbox").nth(1);
    await selected.check();
    await page.getByRole("button", { name: "Open file", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      basename(file),
    );
    await expect(page.getByText("1 column chosen for review")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
    console.log(
      `Supplied CSV ${index + 1}: ${await page.locator(".pagination > span").innerText()}`,
    );
    await page
      .getByRole("button", { name: "Inspect selected text", exact: true })
      .click();
    await expect(
      page.getByText("Inspection complete.", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
    console.log(
      `Supplied CSV ${index + 1}: selected-column inspection completed`,
    );
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download original" }).click();
    expect(await readFile((await (await download).path())!)).toEqual(
      await readFile(file),
    );
  });
}
