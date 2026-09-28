import { expect, test } from "@playwright/test";

test("project dialogs contain keyboard focus, close with Escape and return focus", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Projects & backups" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/projects/i);
  // Native dialogs may let Tab reach browser chrome (body becomes active),
  // but must never focus an inert background control.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i < 6 ? "Tab" : "Shift+Tab");
    expect(
      await dialog.evaluate(
        (el) =>
          el.contains(document.activeElement) ||
          document.activeElement === document.body,
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("save and export dialogs support keyboard dismissal at narrow width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "keyboard.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("ID,Text\n001,plain text"),
  });
  await page.getByRole("button", { name: "Use this layout" }).click();
  await page.getByRole("checkbox", { name: "Column 2: Text" }).check();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  for (const name of ["Save project", "Export reviewed CSV"]) {
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/\S/);
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate(
          (el) =>
            el.contains(document.activeElement) ||
            document.activeElement === document.body,
        ),
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});
