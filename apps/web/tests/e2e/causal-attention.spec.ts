import { expect, test, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const BASE_URL = "http://127.0.0.1:3000";

type FixtureMode = "demo" | "fresh";

async function authenticate(context: BrowserContext, mode: FixtureMode) {
  const response = await context.request.post(`${BASE_URL}/api/v1/__test__/session`, {
    data: { mode },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as {
    ok: boolean;
    mode: FixtureMode;
    user: { id: string; handle: string; displayName: string | null };
  };
  expect(body.ok).toBe(true);
  expect(body.mode).toBe(mode);
  return body.user;
}

async function signOut(context: BrowserContext) {
  const response = await context.request.delete(`${BASE_URL}/api/v1/__test__/session`);
  expect(response.status()).toBe(200);
}

test("vertical slice uses a real bearer session rather than demo auth fallback", async ({ page, context }) => {
  await authenticate(context, "demo");
  try {
    const me = await context.request.get(`${BASE_URL}/api/v1/me`);
    expect(me.status()).toBe(200);

    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Continue the evidence loop." })).toBeVisible();
    await page.getByRole("link", { name: "Lock experiment" }).click();
    await expect(page.getByRole("heading", { name: "Attention Memory Scaling" })).toBeVisible();
  } finally {
    await signOut(context);
  }
});

test("fresh authenticated learner reaches zero-state onboarding and records compute evidence", async ({ page, context }) => {
  const user = await authenticate(context, "fresh");

  try {
    const me = await context.request.get(`${BASE_URL}/api/v1/me`);
    expect(me.status()).toBe(200);
    const meBody = await me.json() as { authenticated: boolean; user: { id: string } };
    expect(meBody.authenticated).toBe(true);
    expect(meBody.user.id).toBe(user.id);

    await page.goto("/home");
    await expect(page.getByText("No experiment yet")).toBeVisible();
    await expect(page.getByText("No GPU report")).toBeVisible();

    await page.goto("/setup/repository");
    await expect(page.getByRole("heading", { name: "Not bound" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Authorize one repository" })).toBeVisible();

    await page.goto("/setup/compute");
    await expect(page.getByRole("heading", { name: "No environment report has been recorded yet" })).toBeVisible();

    await page.goto("/lab/phase-1/causal-attention");
    await expect(page.getByText("No repository bound")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bind a GitHub repository before submitting." })).toBeVisible();

    const report = await context.request.post(`${BASE_URL}/api/v1/environment-reports`, {
      data: {
        pythonVersion: "3.12.14",
        pytorchVersion: "2.8.0",
        operatingSystem: "linux",
        cudaAvailable: false,
        bf16Supported: false,
        selectedProfile: "8gb",
        capturedAt: new Date().toISOString(),
        report: { source: "playwright-real-session" },
      },
    });
    expect(report.status()).toBe(201);
    const body = await report.json() as { ok: boolean; qualification: { status: string; selectedProfile: string } };
    expect(body.ok).toBe(true);
    expect(body.qualification.status).toBe("cuda_required_later");
    expect(body.qualification.selectedProfile).toBe("8gb");

    await page.goto("/setup/compute");
    await expect(page.getByRole("heading", { name: "8gb" })).toBeVisible();
    await expect(page.getByText("cuda required later")).toBeVisible();
    await expect(page.getByText(/CUDA is not currently available/)).toBeVisible();
  } finally {
    await signOut(context);
  }
});

test("learning unit has no automatically detectable accessibility violations", async ({ page, context }) => {
  await authenticate(context, "demo");
  try {
    await page.goto("/learn/phase-1/causal-attention");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  } finally {
    await signOut(context);
  }
});
