import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import corpus from "../fixtures/detection-v1.json" with { type: "json" };
import { executeLocal } from "../../src/processing/execute";
const sample = (id: string) =>
  corpus.cases.find((value) => value.id === id)!.input;
const data = [
  "strong-zawgyi",
  "ambiguous-common-subset",
  "strong-unicode",
  "standard-shan-is-not-zawgyi",
  "mixed-separated-runs",
  "emoji-safe-offset",
].map(sample);
async function open(page: Page, texts = data) {
  await page.goto("/");
  const csv =
    "ID,Text\n" +
    texts
      .map(
        (text, i) =>
          `${i.toString().padStart(4, "0")},"${text.replaceAll('"', '""')}"`,
      )
      .join("\n");
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "review.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Use this layout" }).click();
  await page.getByRole("checkbox", { name: "Column 2: Text" }).check();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
}
async function inspect(page: Page) {
  await page
    .getByRole("button", { name: "Inspect selected text", exact: true })
    .click();
  await expect(
    page.getByText("Inspection complete.", { exact: false }),
  ).toBeVisible();
}
async function convert(page: Page) {
  await page.getByLabel("Propose Unicode conversion").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start new review", exact: true })
    .click();
  await page.getByRole("button", { name: "Run inspection" }).click();
  await expect(
    page.getByText("Inspection complete.", { exact: false }),
  ).toBeVisible();
}
test("inspection, guarded proposals, manual replacement, decisions and invalidation", async ({
  page,
}) => {
  await open(page);
  await inspect(page);
  await expect(page.getByLabel("Normalize Unicode (NFC)")).not.toBeChecked();
  await expect(
    page.locator(".review-summary").getByText("0", { exact: true }),
  ).toHaveCount(3);
  await expect(page.locator(".review-table")).toContainText(
    "Zawgyi · conversion available",
  );
  await expect(page.locator(".review-table")).toContainText(
    "Uncertain encoding",
  );
  await convert(page);
  await page.getByLabel("Review queue").selectOption("changes");
  await expect(page.locator(".review-table tbody tr")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Review row 1,", exact: false })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("pre").nth(0)).toHaveText(data[0]!);
  const expected = executeLocal({
    text: data[0]!,
    convertToUnicode: true,
    normalizeNfc: false,
  });
  await expect(dialog.locator("pre").nth(1)).toHaveText(expected.output);
  await dialog
    .getByRole("button", { name: "Approve change", exact: true })
    .click();
  await page.getByLabel("Review queue").selectOption("approved");
  await expect(page.locator(".review-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Review queue").selectOption("attention");
  await page
    .getByRole("button", { name: "Review row 2,", exact: false })
    .click();
  await dialog.getByText("Write a replacement", { exact: true }).click();
  await dialog.getByLabel("Replacement text").fill("Manually reviewed text 😀");
  await dialog
    .getByRole("button", { name: "Propose replacement", exact: true })
    .click();
  await expect(dialog).toContainText("Awaiting approval");
  await expect(dialog).toContainText("Not verified by the text checks");
  await dialog
    .getByRole("button", { name: "Approve change", exact: true })
    .click();
  await expect(page.locator(".review-table")).toContainText(
    "Uncertain encoding",
  );
  await page
    .getByRole("button", { name: "Review row 2,", exact: false })
    .click();
  await dialog.getByRole("button", { name: "Revoke decision" }).click();
  await dialog
    .getByRole("button", { name: "Keep original", exact: true })
    .click();
  await expect(page.locator(".review-table")).toContainText(
    "Uncertain encoding",
  );
  await page.getByLabel("Normalize Unicode (NFC)").click();
  await dialog
    .getByRole("button", { name: "Start new review", exact: true })
    .click();
  await page.getByLabel("Review queue").selectOption("approved");
  await expect(page.getByText("No cells in this view")).toBeVisible();
  await expect(
    page.getByText("Settings changed.", { exact: false }),
  ).toBeVisible();
});
test("bulk approval is explicit and excludes unresolved and manual proposals", async ({
  page,
}) => {
  await open(page);
  await inspect(page);
  await convert(page);
  await page.getByLabel("Review queue").selectOption("all");
  await page.getByRole("button", { name: "Approve eligible changes" }).click();
  await expect(page.getByRole("dialog")).toContainText("Approve 2 changes?");
  await page
    .getByRole("button", { name: "Confirm approval", exact: true })
    .click();
  await page.getByLabel("Review queue").selectOption("approved");
  await expect(page.locator(".review-table tbody tr")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Review row 6,", exact: false })
    .click();
  await page.getByText("Why this was flagged", { exact: true }).click();
  await expect(page.getByRole("dialog").locator("mark").first()).toHaveText(
    "အျပည္ျပည္ဆိုင္ရာ",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({
    path: "test-results/review-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/review-narrow.png",
    fullPage: true,
  });
});
test("cancellation marks incomplete cells and an explicit restart recovers", async ({
  page,
}) => {
  await open(page);
  await page.route("**/assets/engine.worker-*.js", (route) => route.abort());
  await page
    .getByRole("button", { name: "Inspect selected text", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Inspection stopped");
  await expect(page.locator(".review-table")).toContainText(
    "Inspection failed",
  );
  await expect(page.locator(".review-table")).toContainText(
    "Not inspected · stopped",
  );
  await page.unroute("**/assets/engine.worker-*.js");
  await inspect(page);
  await page.getByRole("button", { name: "Run inspection" }).click();
  await page.route("**/assets/engine.worker-*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: "Start new review", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop inspection" }).click();
  await expect(
    page.getByText("Inspection stopped. Completed", { exact: false }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(
    page.getByText("Inspection complete.", { exact: false }),
  ).not.toBeVisible();
});
test("all selected rows are processed beyond preview and local work makes no uploads or storage writes", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" ||
      !request.url().startsWith("http://127.0.0.1:4173/")
    )
      requests.push(request.url());
  });
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("FORBIDDEN_REVIEW_IO"))
      violations.push(message.text());
  });
  const guard = `const deny=()=>{console.error('FORBIDDEN_REVIEW_IO');throw Error('FORBIDDEN_REVIEW_IO');};globalThis.fetch=deny;globalThis.XMLHttpRequest=deny;globalThis.WebSocket=deny;globalThis.indexedDB.open=deny;if(globalThis.Storage)globalThis.Storage.prototype.setItem=deny;if(globalThis.caches)globalThis.caches.open=deny;if(globalThis.navigator.sendBeacon)globalThis.navigator.sendBeacon=deny;`;
  await page.addInitScript(guard);
  await page.route(/\/(engine|import)\.worker-.*\.js$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `{${guard}}\n${await response.text()}`,
    });
  });
  await open(
    page,
    Array.from({ length: 130 }, (_, i) => (i % 2 ? data[0]! : "hello")),
  );
  await inspect(page);
  await expect(page.getByText("130 of 130 cells inspected")).toBeVisible();
  await page.getByLabel("Review queue").selectOption("all");
  await expect(page.locator(".review-table tbody tr")).toHaveCount(25);
  await page.getByLabel("Cell review results").press("Tab");
  await expect(page.locator(".review-results .pagination")).toContainText(
    "of 130 cells",
  );
  expect(requests).toEqual([]);
  expect(violations).toEqual([]);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Bring your Myanmar text",
  );
});

test("10,000 selected cells finish without limiting results to the preview", async ({
  page,
}) => {
  test.setTimeout(60000);
  await open(
    page,
    Array.from({ length: 10000 }, () => "hello"),
  );
  const start = Date.now();
  await page
    .getByRole("button", { name: "Inspect selected text", exact: true })
    .click();
  await expect(
    page.getByText("Inspection complete.", { exact: false }),
  ).toBeVisible({ timeout: 45000 });
  console.log(`Chromium 10,000-cell review: ${Date.now() - start} ms`);
  await expect(
    page.getByText("10,000 of 10,000 cells inspected"),
  ).toBeVisible();
  await page.getByLabel("Review queue").selectOption("all");
  await expect(page.locator(".review-table tbody tr")).toHaveCount(25);
  await expect(page.locator(".review-results .pagination")).toContainText(
    "of 10,000 cells",
  );
});

test("review limit explains recovery without a partial success claim", async ({
  page,
}) => {
  await open(
    page,
    Array.from({ length: 10001 }, () => "hello"),
  );
  await page
    .getByRole("button", { name: "Inspect selected text", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("10,000 selected cells");
  await expect(
    page.getByText("Inspection complete.", { exact: false }),
  ).not.toBeVisible();
});

test("review dialogs stay centered and numeral uncertainty is explained without changing the text", async ({
  page,
}) => {
  const digits = sample("myanmar-digits-have-no-model-signal");
  await open(page, [digits, sample("ambiguous-common-subset")]);
  await inspect(page);
  await expect(page.locator(".review-table")).toContainText(
    "Encoding unconfirmed",
  );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page
      .getByRole("button", { name: "Review row 1,", exact: false })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".finding-explanation")).toContainText(
      "This does not mean the text is wrong",
    );
    await expect(dialog.locator(".finding-explanation")).toContainText(
      "Myanmar numerals",
    );
    await expect(dialog.locator("pre").first()).toHaveText(digits);
    await dialog.getByText("Write a replacement", { exact: true }).click();
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(
      2,
    );
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(
      2,
    );
    expect(box.y).toBeGreaterThanOrEqual(16);
    expect(box.height).toBeLessThanOrEqual(viewport.height - 32);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/review-dialog-${viewport.width}.png`,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    for (const button of await page
      .locator(".review-results .page-button")
      .all()) {
      expect(
        await button.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
  }
  await page
    .getByRole("button", { name: "Review row 1,", exact: false })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep original", exact: true })
    .click();
  await expect(page.locator(".review-table")).toContainText(
    "Uncertain encoding",
  );
  await expect(page.locator(".review-table")).toContainText("Keep original");
});
