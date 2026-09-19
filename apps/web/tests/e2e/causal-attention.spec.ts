import { expect, test, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  createSessionForUser,
  getDemoUser,
  prisma,
  provisionGitHubIdentity,
  revokeSessionToken,
} from "@fpllm/db";

const BASE_URL = "http://127.0.0.1:3000";

async function authenticate(context: BrowserContext, userId: string) {
  const { token } = await createSessionForUser(userId, { ttlMs: 10 * 60 * 1000 });
  await context.addCookies([{
    name: "fpllm_session",
    value: token,
    url: BASE_URL,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  return token;
}

test("vertical slice uses a real bearer session rather than demo auth fallback", async ({ page, context }) => {
  const demo = await getDemoUser();
  const token = await authenticate(context, demo.id);
  try {
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Continue the evidence loop." })).toBeVisible();
    await page.getByRole("link", { name: "Lock experiment" }).click();
    await expect(page.getByRole("heading", { name: "Attention Memory Scaling" })).toBeVisible();
  } finally {
    await revokeSessionToken(token);
  }
});

test("fresh authenticated learner reaches zero-state onboarding and records compute evidence", async ({ page, context }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await provisionGitHubIdentity({
    providerUserId: `playwright-${suffix}`,
    login: `playwright-${suffix}`,
    displayName: "Playwright Fresh Learner",
  });
  const token = await authenticate(context, user.id);

  try {
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
    await revokeSessionToken(token);
    await prisma.computeProfile.deleteMany({ where: { userId: user.id } });
    await prisma.environmentReport.deleteMany({ where: { userId: user.id } });
    await prisma.auditEvent.deleteMany({ where: { actorUserId: user.id } });
    await prisma.identity.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test("learning unit has no automatically detectable accessibility violations", async ({ page, context }) => {
  const demo = await getDemoUser();
  const token = await authenticate(context, demo.id);
  try {
    await page.goto("/learn/phase-1/causal-attention");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  } finally {
    await revokeSessionToken(token);
  }
});
