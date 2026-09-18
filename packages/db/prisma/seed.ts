import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const FULL_SHA = "7bc81eaf2c4d6a8b0c1e2f3456789abcdeffedcb";
const courseManifestPath = resolve(process.cwd(), "../../course/content-manifest.json");
const manifest = JSON.parse(await readFile(courseManifestPath, "utf8")) as { contentSha256: string };

const user = await prisma.user.upsert({
  where: { handle: "demo" },
  update: { displayName: "Demo Learner" },
  create: { handle: "demo", displayName: "Demo Learner" },
});

const courseVersion = await prisma.courseVersion.upsert({
  where: { courseId_version: { courseId: "first-principles-llm-research", version: "1.0" } },
  update: { contentSha256: manifest.contentSha256 },
  create: {
    courseId: "first-principles-llm-research",
    version: "1.0",
    contentSha256: manifest.contentSha256,
    publishedAt: new Date("2026-09-18T00:00:00Z"),
  },
});

const unitVersion = await prisma.unitVersion.upsert({
  where: { courseVersionId_unitId_version: { courseVersionId: courseVersion.id, unitId: "phase1-causal-attention", version: "1.0" } },
  update: { contentSha256: manifest.contentSha256 },
  create: { courseVersionId: courseVersion.id, unitId: "phase1-causal-attention", version: "1.0", contentSha256: manifest.contentSha256 },
});

await prisma.enrollment.upsert({
  where: { userId_courseVersionId: { userId: user.id, courseVersionId: courseVersion.id } },
  update: { currentUnitId: "phase1-causal-attention", track: "research_engineer" },
  create: { userId: user.id, courseVersionId: courseVersion.id, track: "research_engineer", currentUnitId: "phase1-causal-attention" },
});

await prisma.learnerUnitState.upsert({
  where: { userId_unitVersionId: { userId: user.id, unitVersionId: unitVersion.id } },
  update: { state: "experimenting" },
  create: { userId: user.id, unitVersionId: unitVersion.id, state: "experimenting" },
});

const compute = await prisma.computeProfile.findFirst({ where: { userId: user.id } });
if (!compute) {
  await prisma.computeProfile.create({
    data: {
      userId: user.id,
      detectedGpu: "NVIDIA RTX 3070",
      vramGiB: 8,
      bf16Supported: false,
      cudaAvailable: true,
      selectedProfile: "8gb",
      precision: "fp16",
      gradScaler: true,
      evidenceJson: { source: "seed-fixture", qualified: true },
    },
  });
}

const repository = await prisma.repository.upsert({
  where: { userId_provider_owner_name: { userId: user.id, provider: "github", owner: "yourname", name: "fpllm" } },
  update: { defaultBranch: "main" },
  create: { userId: user.id, provider: "github", owner: "yourname", name: "fpllm", defaultBranch: "main" },
});

let submission = await prisma.submission.findFirst({ where: { userId: user.id, commitSha: FULL_SHA, labId: "phase1-causal-attention-lab" } });
if (!submission) {
  submission = await prisma.submission.create({
    data: {
      userId: user.id,
      repositoryId: repository.id,
      courseVersionId: courseVersion.id,
      labId: "phase1-causal-attention-lab",
      labVersion: "1.0",
      branch: "phase1-attention",
      commitSha: FULL_SHA,
      state: "passed",
      finalizedAt: new Date(),
    },
  });
  const run = await prisma.testRun.create({ data: { submissionId: submission.id, state: "passed", startedAt: new Date(), completedAt: new Date() } });
  const results = [
    ["public", "shape", "attention.shape", true, "Output shape is [B,S,768]."],
    ["public", "causal", "attention.causal", true, "Future changes do not affect earlier positions."],
    ["public", "gqa", "attention.gqa_equivalence", true, "GQA matches explicit repeat reference."],
    ["public", "grad", "attention.gradients", true, "Gradients reach Q/K/V/O projections."],
    ["hidden", "numerics", "attention.randomized_numerics", true, "Randomized numerical reference passed."],
    ["hidden", "memory", "attention.no_permanent_kv_repeat", true, "No permanent repeated KV storage observed."],
  ] as const;
  for (const [visibility, groupId, invariantId, passed, summary] of results) {
    await prisma.testResult.create({ data: { testRunId: run.id, visibility, groupId, invariantId, passed, summary } });
  }
}

for (const [dimension, evidenceType] of [
  ["conceptual", "concept-check-and-explanation"],
  ["implementation", "immutable-submission"],
  ["publicTests", "test-run"],
  ["hiddenTests", "invariant-oriented-hidden-test-run"],
  ["experiment", "attention-memory-scaling"],
  ["interpretation", "versioned-journal-entry"],
] as const) {
  await prisma.masteryRequirement.upsert({
    where: { unitId_unitVersion_dimension: { unitId: "phase1-causal-attention", unitVersion: "1.0", dimension } },
    update: { evidenceType },
    create: { unitId: "phase1-causal-attention", unitVersion: "1.0", dimension, evidenceType },
  });
}

for (const [dimension, evidenceType, evidenceRef] of [
  ["conceptual", "concept-check-and-explanation", "seed:concept-check"],
  ["implementation", "immutable-submission", submission.id],
  ["publicTests", "test-run", `submission:${submission.id}:public`],
  ["hiddenTests", "invariant-oriented-hidden-test-run", `submission:${submission.id}:hidden`],
] as const) {
  await prisma.masteryEvidence.upsert({
    where: { userId_unitId_unitVersion_dimension_evidenceRef: { userId: user.id, unitId: "phase1-causal-attention", unitVersion: "1.0", dimension, evidenceRef } },
    update: { status: "passed" },
    create: { userId: user.id, unitId: "phase1-causal-attention", unitVersion: "1.0", dimension, evidenceType, evidenceRef, status: "passed" },
  });
}

let experiment = await prisma.experiment.findUnique({ where: { displayId: "E-014" } });
if (!experiment) {
  experiment = await prisma.experiment.create({
    data: {
      displayId: "E-014",
      userId: user.id,
      submissionId: submission.id,
      experimentType: "attention_memory_scaling",
      state: "draft",
      commitSha: FULL_SHA,
    },
  });
}

await prisma.masteryState.upsert({
  where: { userId_unitVersionId: { userId: user.id, unitVersionId: unitVersion.id } },
  update: { status: "needs_evidence", computedAt: new Date() },
  create: { userId: user.id, unitVersionId: unitVersion.id, status: "needs_evidence" },
});

console.log(JSON.stringify({ seeded: true, userId: user.id, submissionId: submission.id, experimentId: experiment.id, displayId: experiment.displayId }, null, 2));
await prisma.$disconnect();
