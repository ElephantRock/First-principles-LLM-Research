import { expect, test, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const BASE_URL = "http://127.0.0.1:3000";

type FixtureMode = "demo" | "fresh";

async function authenticate(context: BrowserContext, mode: FixtureMode) {
  const response = await context.request.post(`${BASE_URL}/api/v1/e2e/session`, {
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
  const response = await context.request.delete(`${BASE_URL}/api/v1/e2e/session`);
  expect(response.status()).toBe(200);
}

async function learnerFixture(context: BrowserContext, data: Record<string, unknown>) {
  return context.request.post(`${BASE_URL}/api/v1/e2e/learner-fixture`, { data });
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

test("fresh learner completes no-seed onboarding through queued, running, and evidence UX", async ({ page, context }) => {
  const user = await authenticate(context, "fresh");

  try {
    const me = await context.request.get(`${BASE_URL}/api/v1/me`);
    expect(me.status()).toBe(200);
    const meBody = await me.json() as {
      ok: boolean;
      user: { id: string };
      session: { id: string; expiresAt: string } | null;
    };
    expect(meBody.ok).toBe(true);
    expect(meBody.user.id).toBe(user.id);
    expect(meBody.session).not.toBeNull();

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
    const reportBody = await report.json() as {
      ok: boolean;
      qualification: { status: string; selectedProfile: string };
    };
    expect(reportBody.ok).toBe(true);
    expect(reportBody.qualification.status).toBe("cuda_required_later");
    expect(reportBody.qualification.selectedProfile).toBe("8gb");

    await page.goto("/setup/compute");
    await expect(page.getByRole("heading", { name: "8gb" })).toBeVisible();
    await expect(page.getByText("cuda required later")).toBeVisible();
    await expect(page.getByText(/CUDA is not currently available/)).toBeVisible();

    const bind = await learnerFixture(context, { action: "bind_repository" });
    expect(bind.status()).toBe(201);
    const bindBody = await bind.json() as {
      ok: boolean;
      repository: { id: string; owner: string; name: string; defaultBranch: string };
    };
    expect(bindBody.ok).toBe(true);

    await page.goto("/lab/phase-1/causal-attention");
    await expect(page.getByText(`${bindBody.repository.owner}/${bindBody.repository.name}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit immutable commit" })).toBeVisible();
    await expect(page.locator("#submission-branch")).toHaveValue("main");

    const commitSha = "c".repeat(40);
    const queued = await learnerFixture(context, {
      action: "queue_submission",
      repositoryId: bindBody.repository.id,
      commitSha,
    });
    expect(queued.status()).toBe(201);
    const queuedBody = await queued.json() as {
      ok: boolean;
      submission: { id: string };
      testRun: { id: string; state: string };
    };
    expect(queuedBody.ok).toBe(true);
    expect(queuedBody.testRun.state).toBe("queued");

    await page.goto(`/lab/phase-1/causal-attention/submission/${queuedBody.submission.id}`);
    await expect(page.getByRole("heading", { name: "queued", exact: true })).toBeVisible();
    await expect(page.getByText(commitSha, { exact: true })).toBeVisible();

    const running = await learnerFixture(context, {
      action: "set_running",
      submissionId: queuedBody.submission.id,
    });
    expect(running.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "running", exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("cell", { name: "running_public", exact: true })).toBeVisible();

    const completed = await learnerFixture(context, {
      action: "complete_pass",
      submissionId: queuedBody.submission.id,
    });
    expect(completed.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "passed", exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("link", { name: "View evidence" })).toBeVisible();

    await page.getByRole("link", { name: "View evidence" }).click();
    await expect(page.getByRole("heading", { name: "Implementation gate passed." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "4 / 4" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "2 / 2" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start experiment" })).toBeVisible();
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
