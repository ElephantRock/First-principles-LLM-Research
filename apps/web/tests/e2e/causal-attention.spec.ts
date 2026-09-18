import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("vertical slice exposes the evidence loop", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Continue the evidence loop." })).toBeVisible();
  await page.getByRole("link", { name: "Run experiment" }).click();
  await expect(page.getByRole("heading", { name: "Attention Memory Scaling" })).toBeVisible();
});

test("learning unit has no automatically detectable accessibility violations", async ({ page }) => {
  await page.goto("/learn/phase-1/causal-attention");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
