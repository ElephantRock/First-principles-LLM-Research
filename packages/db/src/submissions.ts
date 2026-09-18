import { prisma } from "./client";
import { getDemoUser } from "./evidence";

const CAUSAL_ATTENTION_LAB_ID = "phase1-causal-attention-lab";
const COURSE_ID = "first-principles-llm-research";
const COURSE_VERSION = "1.0";
const TEST_BUNDLE_ID = "phase1-causal-attention@1.0";

export interface VerifiedRepositoryIdentity {
  repositoryDbId: string;
  installationId: string;
  owner: string;
  name: string;
  providerRepositoryId: string | null;
  defaultBranch: string | null;
}

export async function getBoundRepositoryIdentityForDemo(repositoryId: string): Promise<VerifiedRepositoryIdentity> {
  const user = await getDemoUser();
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, userId: user.id, provider: "github" },
    include: { githubInstallation: true },
  });

  if (!repository) throw new Error("REPOSITORY_NOT_FOUND");
  if (!repository.githubInstallation) throw new Error("REPOSITORY_NOT_BOUND");
  if (repository.githubInstallation.suspendedAt) throw new Error("GITHUB_INSTALLATION_SUSPENDED");

  return {
    repositoryDbId: repository.id,
    installationId: repository.githubInstallation.githubInstallationId.toString(),
    owner: repository.owner,
    name: repository.name,
    providerRepositoryId: repository.providerRepositoryId?.toString() ?? null,
    defaultBranch: repository.defaultBranch,
  };
}

export async function createVerifiedSubmissionAndQueueForDemo(input: {
  repositoryId: string;
  branch: string;
  commitSha: string;
  labVersion: string;
}) {
  const user = await getDemoUser();

  return prisma.$transaction(async (tx) => {
    const repository = await tx.repository.findFirst({
      where: { id: input.repositoryId, userId: user.id, provider: "github" },
      include: { githubInstallation: true },
    });
    if (!repository) throw new Error("REPOSITORY_NOT_FOUND");
    if (!repository.githubInstallation) throw new Error("REPOSITORY_NOT_BOUND");
    if (repository.githubInstallation.suspendedAt) throw new Error("GITHUB_INSTALLATION_SUSPENDED");

    const courseVersion = await tx.courseVersion.findFirst({
      where: { courseId: COURSE_ID, version: COURSE_VERSION },
    });
    if (!courseVersion) throw new Error("COURSE_VERSION_NOT_FOUND");

    const submission = await tx.submission.create({
      data: {
        userId: user.id,
        repositoryId: repository.id,
        courseVersionId: courseVersion.id,
        labId: CAUSAL_ATTENTION_LAB_ID,
        labVersion: input.labVersion,
        branch: input.branch,
        commitSha: input.commitSha,
        state: "submitted",
      },
    });

    const testRun = await tx.testRun.create({
      data: {
        submissionId: submission.id,
        state: "queued",
      },
    });

    const payload = {
      schemaVersion: "1",
      submissionId: submission.id,
      testRunId: testRun.id,
      source: {
        provider: "github",
        installationId: repository.githubInstallation.githubInstallationId.toString(),
        repositoryId: repository.providerRepositoryId?.toString() ?? null,
        owner: repository.owner,
        name: repository.name,
        commitSha: submission.commitSha,
      },
      testBundleId: TEST_BUNDLE_ID,
      execution: {
        timeoutSeconds: 180,
        cpuLimit: 2,
        memoryMiB: 4096,
        pidsLimit: 256,
        networkEnabled: false,
      },
    };

    const job = await tx.job.create({
      data: {
        jobType: "submission_test",
        state: "queued",
        testRunId: testRun.id,
        payloadJson: payload,
        nextAttemptAt: new Date(),
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: user.id,
        eventType: "submission.queued",
        objectType: "submission",
        objectId: submission.id,
        correlationId: job.id,
        dataJson: {
          repositoryId: repository.id,
          commitSha: submission.commitSha,
          testRunId: testRun.id,
          jobId: job.id,
          testBundleId: TEST_BUNDLE_ID,
        },
      },
    });

    return {
      submission,
      testRun: { id: testRun.id, state: testRun.state },
      job: { id: job.id, state: job.state, jobType: job.jobType },
    };
  });
}
