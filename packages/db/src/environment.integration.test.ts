import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./client";
import { qualifyEnvironment, recordEnvironmentReportForUser } from "./environment";

const GIB = 1024 ** 3;

function baseInput() {
  return {
    pythonVersion: "3.12.10",
    pytorchVersion: "2.8.0",
    operatingSystem: "linux",
    cudaVersion: "12.8",
    cudaAvailable: true,
    gpuModel: "Fixture GPU",
    totalVramBytes: 10 * GIB,
    bf16Supported: false,
    fpllmVersion: "0.4.0",
    repositoryCommit: "a".repeat(40),
    capturedAt: new Date().toISOString(),
    report: { source: "environment.integration.test" },
  } as const;
}

test("qualification preserves learner-selected profile and reports adaptations", () => {
  const unselected = qualifyEnvironment(baseInput());
  assert.equal(unselected.status, "awaiting_profile_selection");
  assert.equal(unselected.recommendedProfile, "8gb");
  assert.equal(unselected.execution.precision, "fp16");
  assert.equal(unselected.execution.gradScaler, true);
  assert.ok(unselected.diagnostics.some((item) => item.code === "profile_selection_required"));

  const oversized = qualifyEnvironment({ ...baseInput(), selectedProfile: "12gb" });
  assert.equal(oversized.selectedProfile, "12gb");
  assert.equal(oversized.status, "selected_profile_exceeds_detected_vram");
  assert.ok(oversized.diagnostics.some((item) => item.code === "selected_profile_exceeds_detected_vram"));

  const supported = qualifyEnvironment({ ...baseInput(), selectedProfile: "8gb" });
  assert.equal(supported.selectedProfile, "8gb");
  assert.equal(supported.status, "qualified_with_adaptations");
  assert.equal(supported.execution.microBatchSize, 2);
  assert.equal(supported.execution.gradientAccumulationSteps, 32);
  assert.equal(supported.execution.activationCheckpointing, true);
});

test("authenticated environment evidence creates a learner-owned compute profile", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({ data: { handle: `environment-${suffix}` } });

  try {
    const result = await recordEnvironmentReportForUser(user.id, {
      ...baseInput(),
      selectedProfile: "8gb",
    });

    assert.ok(result.environmentReportId);
    assert.ok(result.computeProfileId);
    assert.equal(result.qualification.status, "qualified_with_adaptations");

    const environmentReport = await prisma.environmentReport.findUniqueOrThrow({
      where: { id: result.environmentReportId },
    });
    const computeProfile = await prisma.computeProfile.findUniqueOrThrow({
      where: { id: result.computeProfileId! },
    });

    assert.equal(environmentReport.userId, user.id);
    assert.equal(environmentReport.selectedProfile, "8gb");
    assert.equal(computeProfile.userId, user.id);
    assert.equal(computeProfile.selectedProfile, "8gb");
    assert.equal(computeProfile.precision, "fp16");
    assert.equal(computeProfile.gradScaler, true);
    assert.equal(computeProfile.cudaAvailable, true);
    assert.equal(computeProfile.vramGiB, 10);
  } finally {
    await prisma.computeProfile.deleteMany({ where: { userId: user.id } });
    await prisma.environmentReport.deleteMany({ where: { userId: user.id } });
    await prisma.auditEvent.deleteMany({ where: { actorUserId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
