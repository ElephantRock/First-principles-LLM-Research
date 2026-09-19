import { z } from "zod";

export const fullGitShaSchema = z.string().regex(/^[0-9a-f]{40}$/i);
export const opaqueIdSchema = z.string().uuid();

export const submissionCreateSchema = z.object({
  repositoryId: opaqueIdSchema,
  branch: z.string().min(1).max(255),
  commit: fullGitShaSchema,
  labId: z.literal("phase1-causal-attention-lab"),
  labVersion: z.literal("1.0"),
});

export const experimentCreateSchema = z.object({
  submissionId: opaqueIdSchema,
  experimentType: z.literal("attention_memory_scaling"),
});

export const experimentLockSchema = z.object({
  hypothesis: z.string().trim().min(20).max(4000),
  prediction: z.string().trim().min(20).max(4000),
});

export const experimentRunSchema = z.object({
  sequenceLength: z.union([z.literal(128), z.literal(256), z.literal(512), z.literal(1024)]),
  peakAllocatedBytes: z.number().int().nonnegative().optional(),
  peakReservedBytes: z.number().int().nonnegative().optional(),
  tokensPerSecond: z.number().positive().optional(),
  stepSeconds: z.number().positive().optional(),
  status: z.enum(["complete", "oom", "failed"]),
  failureCode: z.string().max(120).optional(),
}).superRefine((run, ctx) => {
  if (run.status === "complete") {
    for (const field of ["peakAllocatedBytes", "peakReservedBytes", "tokensPerSecond", "stepSeconds"] as const) {
      if (run[field] == null) ctx.addIssue({ code: "custom", path: [field], message: `${field} is required for a complete run` });
    }
  }
});

export const experimentArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  experimentId: opaqueIdSchema,
  experimentType: z.literal("attention_memory_scaling"),
  submissionCommit: fullGitShaSchema,
  environmentReportId: opaqueIdSchema.optional(),
  runs: z.array(experimentRunSchema).min(1).max(4),
});

export const interpretationCreateSchema = z.object({
  observation: z.string().trim().min(20).max(8000),
  interpretation: z.string().trim().min(40).max(12000),
  uncertainty: z.string().trim().min(20).max(8000),
  nextExperiment: z.string().trim().max(8000).optional(),
  conclusion: z.enum(["supports", "partially_supports", "does_not_support", "inconclusive"]),
});

export const environmentReportSchema = z.object({
  pythonVersion: z.string().optional(),
  pytorchVersion: z.string().optional(),
  operatingSystem: z.string().optional(),
  cudaVersion: z.string().optional(),
  cudaAvailable: z.boolean().optional(),
  gpuModel: z.string().optional(),
  totalVramBytes: z.number().int().nonnegative().optional(),
  bf16Supported: z.boolean().optional(),
  selectedProfile: z.enum(["8gb", "12gb", "16gb"]).optional(),
  fpllmVersion: z.string().optional(),
  repositoryCommit: fullGitShaSchema.optional(),
  capturedAt: z.string().datetime(),
  report: z.record(z.string(), z.unknown()),
});

export type SubmissionCreate = z.infer<typeof submissionCreateSchema>;
export type ExperimentCreate = z.infer<typeof experimentCreateSchema>;
export type ExperimentLock = z.infer<typeof experimentLockSchema>;
export type ExperimentArtifact = z.infer<typeof experimentArtifactSchema>;
export type InterpretationCreate = z.infer<typeof interpretationCreateSchema>;
export type EnvironmentReport = z.infer<typeof environmentReportSchema>;

export const repositoryDiscoverySchema = z.object({
  owner: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  repo: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  ref: z.string().trim().min(1).max(255),
});

/**
 * Binding no longer accepts a caller-supplied installation id. The authorization
 * token is minted only after a transient GitHub App user token proves that the
 * authenticated learner can reach the requested repository.
 */
export const repositoryBindSchema = z.object({
  authorization: z.string().min(40).max(4096),
  ref: z.string().trim().min(1).max(255),
});

export type RepositoryDiscovery = z.infer<typeof repositoryDiscoverySchema>;
export type RepositoryBind = z.infer<typeof repositoryBindSchema>;
