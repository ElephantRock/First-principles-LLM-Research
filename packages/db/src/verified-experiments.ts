import { prisma } from "./client";
import { getDemoUser } from "./evidence";

const requiredInvariantIds = [
  "attention.shape",
  "attention.causal",
  "attention.gqa_equivalence",
  "attention.gradients",
  "attention.randomized_numerics",
  "attention.no_permanent_kv_repeat",
] as const;

/** Create an experiment only from immutable submission evidence that actually passed the required test bundle. */
export async function createVerifiedExperimentForDemo(submissionId: string) {
  const user = await getDemoUser();
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, userId: user.id },
    include: {
      testRuns: {
        where: { state: "passed" },
        orderBy: { completedAt: "desc" },
        take: 1,
        include: { results: true },
      },
    },
  });
  if (!submission) throw new Error("SUBMISSION_NOT_FOUND");
  if (submission.state !== "passed") throw new Error("SUBMISSION_NOT_VERIFIED");

  const passingRun = submission.testRuns[0];
  if (!passingRun) throw new Error("PASSING_TEST_RUN_REQUIRED");
  const resultByInvariant = new Map(passingRun.results.map((result) => [result.invariantId, result]));
  const completePass = requiredInvariantIds.every((id) => resultByInvariant.get(id)?.passed === true);
  if (!completePass) throw new Error("REQUIRED_TEST_EVIDENCE_INCOMPLETE");

  return prisma.$transaction(async (tx) => {
    // Human-readable experiment IDs are allocated under a transaction-scoped
    // advisory lock so concurrent verified submissions cannot claim the same ID.
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(734701320031)");
    const rows = await tx.$queryRawUnsafe<Array<{ nextId: number }>>(`
      SELECT COALESCE(MAX(SUBSTRING("displayId" FROM 3)::integer), 13) + 1 AS "nextId"
      FROM "Experiment"
      WHERE "displayId" ~ '^E-[0-9]+$'
    `);
    const nextId = rows[0]?.nextId;
    if (typeof nextId !== "number" || !Number.isSafeInteger(nextId) || nextId < 14) {
      throw new Error("EXPERIMENT_DISPLAY_ID_ALLOCATION_FAILED");
    }
    const displayId = `E-${String(nextId).padStart(3, "0")}`;

    return tx.experiment.create({
      data: {
        displayId,
        userId: user.id,
        submissionId: submission.id,
        experimentType: "attention_memory_scaling",
        state: "draft",
        commitSha: submission.commitSha,
      },
    });
  });
}
