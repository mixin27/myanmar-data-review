import { expect, test } from "@playwright/test";
import { createMyanLexApplication } from "@myanlex/application";
import corpus from "../fixtures/detection-v1.json" with { type: "json" };
import type { ProcessingResult } from "../../src/processing/contracts";

const application = createMyanLexApplication();
const sample = (id: string) =>
  corpus.cases.find((entry) => entry.id === id)!.input;

test("production worker matches pinned services and does not upload or persist text", async ({
  page,
  context,
}) => {
  const violations: string[] = [];
  const network: { url: string; method: string; type: string }[] = [];
  context.on("request", (request) =>
    network.push({
      url: request.url(),
      method: request.method(),
      type: request.resourceType(),
    }),
  );
  page.on("console", (message) => {
    if (message.text().includes("FORBIDDEN_LOCAL_IO"))
      violations.push(message.text());
  });
  // Instrument both browser realms. Violations are observable even if callers catch errors.
  const guard = `
    const deny = () => { console.error('FORBIDDEN_LOCAL_IO'); throw new Error('FORBIDDEN_LOCAL_IO'); };
    globalThis.fetch = deny;
    globalThis.XMLHttpRequest = deny;
    globalThis.WebSocket = deny;
    globalThis.indexedDB.open = deny;
    globalThis.indexedDB.deleteDatabase = deny;
    if (globalThis.caches) globalThis.caches.open = deny;
    if (globalThis.Storage) globalThis.Storage.prototype.setItem = deny;
    if (globalThis.navigator.sendBeacon) globalThis.navigator.sendBeacon = deny;
  `;
  await page.addInitScript(guard);
  await page.route("**/engine.worker-*.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `{${guard}}\n${await response.text()}`,
    });
  });
  await page.goto("/tests/browser/worker.html");
  const initialCount = network.length;
  for (const text of [
    sample("strong-unicode"),
    sample("strong-zawgyi"),
    sample("ambiguous-common-subset"),
    `${sample("strong-unicode")} / ${sample("strong-zawgyi")}`,
    "hello 😀 <script>not executable</script>",
  ]) {
    await page.getByLabel("Text to inspect").fill(text);
    await page.getByRole("button", { name: "Run locally" }).click();
    await expect(page.getByRole("status")).toContainText("Completed");
    const result = JSON.parse(
      (await page.getByTestId("result-json").textContent())!,
    ) as ProcessingResult;
    expect(result.original).toBe(text);
    expect(result.output).toBe(text);
    expect(result.detection).toEqual(application.detectText({ text }));
    expect(result.engine.mode).toBe("local");
    expect(result.engine.upstreamCommit).toBe(
      "51d8d6353d7f08fe389e046fac4c5953a70de33b",
    );
    expect(result.conversion).toBeNull();
    expect(result.normalization).toBeNull();
  }
  const text = sample("strong-zawgyi");
  await page.getByLabel("Text to inspect").fill(text);
  await page.getByLabel("Propose guarded conversion").check();
  await page.getByLabel("Apply NFC").check();
  await page.getByRole("button", { name: "Run locally" }).click();
  await expect(page.getByRole("status")).toHaveText("Completed");
  const result = JSON.parse(
    (await page.getByTestId("result-json").textContent())!,
  ) as ProcessingResult;
  const conversion = application.convertText({
    text,
    from: "zawgyi",
    to: "unicode",
    validateSource: true,
  });
  const normalization = application.normalizeText({ text: conversion.output });
  expect(result.conversion).toEqual(conversion);
  expect(result.normalization).toEqual(normalization);
  expect(result.validation).toEqual(
    application.validateOrthography({ text: normalization.output }),
  );
  expect(result.output).toBe(normalization.output);
  expect(violations).toEqual([]);
  for (const request of network.slice(initialCount)) {
    expect(request.method).toBe("GET");
    expect(request.url).toMatch(
      /^http:\/\/127\.0\.0\.1:4173\/assets\/engine\.worker-[\w-]+\.js$/,
    );
    expect(["fetch", "xhr", "websocket"]).not.toContain(request.type);
  }
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(await context.cookies()).toEqual([]);
  await page.reload();
  await expect(page.getByLabel("Text to inspect")).toHaveValue("");
  await expect(page.getByTestId("result-json")).toHaveCount(0);
});

test("keyboard run, cancellation and edit invalidation cannot show stale results", async ({
  page,
}) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/engine.worker-*.js", async (route) => {
    await blocked;
    await route.continue();
  });
  await page.goto("/tests/browser/worker.html");
  await page.getByLabel("Text to inspect").fill(sample("strong-zawgyi"));
  await page.getByRole("button", { name: "Run locally" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Processing locally");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Cancelled");
  await expect(page.getByTestId("result-json")).toHaveCount(0);
  release();
  await page.unrouteAll({ behavior: "wait" });
  await page.getByLabel("Text to inspect").fill("new revision 😀");
  await page.getByRole("button", { name: "Run locally" }).click();
  await expect(page.getByRole("status")).toHaveText("Completed");
  await expect(page.getByLabel("Output preview")).toHaveValue(
    "new revision 😀",
  );
  await page.getByLabel("Text to inspect").fill("edited");
  await expect(page.getByTestId("result-json")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Ready");
});

test("failed worker startup recovers only on an explicit new run", async ({
  page,
}) => {
  await page.route("**/engine.worker-*.js", (route) => route.abort());
  await page.goto("/tests/browser/worker.html");
  await page.getByLabel("Text to inspect").fill("hello");
  await page.getByRole("button", { name: "Run locally" }).click();
  await expect(page.getByRole("status")).toContainText("worker_failure");
  await expect(page.getByTestId("result-json")).toHaveCount(0);
  await page.unrouteAll();
  await page.getByRole("button", { name: "Run locally" }).click();
  await expect(page.getByRole("status")).toHaveText("Completed");
});

test("application input failure stays distinct from an unchanged result", async ({
  page,
}) => {
  await page.goto("/tests/browser/worker.html");
  await page.getByLabel("Text to inspect").fill("x".repeat(100001));
  await page.getByRole("button", { name: "Run locally" }).click();
  await expect(page.getByRole("status")).toContainText("text_too_long");
  await expect(page.getByTestId("result-json")).toHaveCount(0);
  await page.getByLabel("Text to inspect").fill("valid");
  await page.getByRole("button", { name: "Run locally" }).click();
  await expect(page.getByRole("status")).toHaveText("Completed");
});

test("timeout terminates a stuck worker and the next run uses a fresh worker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeTimeout = window.setTimeout.bind(window);
    let shortenFirstDeadline = true;
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) =>
      nativeTimeout(
        handler,
        timeout === 30_000 && shortenFirstDeadline
          ? ((shortenFirstDeadline = false), 50)
          : timeout,
        ...args,
      )) as typeof window.setTimeout;
    const NativeWorker = window.Worker;
    let first = true;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (first) {
          first = false;
          this.postMessage = () => {};
        }
      }
    };
  });
  await page.goto("/tests/browser/worker.html");
  await page.getByLabel("Text to inspect").fill("hello");
  await page.getByRole("button", { name: "Run locally" }).click();
  await expect(page.getByRole("status")).toContainText("timeout:");
  await expect(page.getByTestId("result-json")).toHaveCount(0);
  await page.getByRole("button", { name: "Run locally" }).click();
  await expect(page.getByRole("status")).toHaveText("Completed");
});
