import { prisma } from "./client";

export type HardwareProfile = "8gb" | "12gb" | "16gb";
export type QualificationSeverity = "info" | "warning" | "action";
export type QualificationStatus =
  | "awaiting_profile_selection"
  | "cuda_required_later"
  | "selected_profile_exceeds_detected_vram"
  | "qualified_with_adaptations"
  | "qualified";

export interface EnvironmentReportInput {
  pythonVersion?: string;
  pytorchVersion?: string;
  operatingSystem?: string;
  cudaVersion?: string;
  cudaAvailable?: boolean;
  gpuModel?: string;
  totalVramBytes?: number;
  bf16Supported?: boolean;
  selectedProfile?: HardwareProfile;
  fpllmVersion?: string;
  repositoryCommit?: string;
  capturedAt: string;
  report: Record<string, unknown>;
}

export interface QualificationDiagnostic {
  code: string;
  severity: QualificationSeverity;
  summary: string;
}

const GIB = 1024 ** 3;
const PROFILE_VRAM_GIB: Record<HardwareProfile, number> = {
  "8gb": 8,
  "12gb": 12,
  "16gb": 16,
};

const PROFILE_EXECUTION: Record<HardwareProfile, {
  sequenceLength: 512;
  microBatchSize: number;
  gradientAccumulationSteps: number;
  tokensPerUpdate: 32768;
  activationCheckpointing: boolean;
}> = {
  "8gb": {
    sequenceLength: 512,
    microBatchSize: 2,
    gradientAccumulationSteps: 32,
    tokensPerUpdate: 32768,
    activationCheckpointing: true,
  },
  "12gb": {
    sequenceLength: 512,
    microBatchSize: 4,
    gradientAccumulationSteps: 16,
    tokensPerUpdate: 32768,
    activationCheckpointing: false,
  },
  "16gb": {
    sequenceLength: 512,
    microBatchSize: 8,
    gradientAccumulationSteps: 8,
    tokensPerUpdate: 32768,
    activationCheckpointing: false,
  },
};

function inferCudaAvailable(input: Pick<EnvironmentReportInput, "cudaAvailable" | "cudaVersion" | "gpuModel">) {
  if (typeof input.cudaAvailable === "boolean") return input.cudaAvailable;
  return Boolean(input.cudaVersion && input.gpuModel);
}

function recommendedProfile(totalVramBytes?: number): HardwareProfile | null {
  if (totalVramBytes == null) return null;
  if (totalVramBytes >= 16 * GIB) return "16gb";
  if (totalVramBytes >= 12 * GIB) return "12gb";
  if (totalVramBytes >= 8 * GIB) return "8gb";
  return null;
}

export function qualifyEnvironment(input: EnvironmentReportInput) {
  const diagnostics: QualificationDiagnostic[] = [];
  const cudaAvailable = inferCudaAvailable(input);
  const bf16Supported = input.bf16Supported === true;
  const selectedProfile = input.selectedProfile ?? null;
  const detectedVramGiB = input.totalVramBytes == null ? null : input.totalVramBytes / GIB;
  const detectedRecommendation = recommendedProfile(input.totalVramBytes);

  if (!cudaAvailable) {
    diagnostics.push({
      code: "cuda_unavailable",
      severity: "action",
      summary: "CUDA is not currently available. CPU-compatible early work remains usable, but later GPU qualification requires temporary or local CUDA access.",
    });
  }

  if (input.totalVramBytes != null && input.totalVramBytes < 8 * GIB) {
    diagnostics.push({
      code: "detected_vram_below_minimum",
      severity: "action",
      summary: "Detected VRAM is below the 8 GB minimum course profile. Keep the architecture unchanged and plan to use another CUDA device for GPU-qualified work.",
    });
  }

  if (cudaAvailable && input.totalVramBytes == null) {
    diagnostics.push({
      code: "vram_not_reported",
      severity: "warning",
      summary: "CUDA is available, but VRAM was not reported. Profile fit cannot be checked until memory capacity is measured.",
    });
  }

  if (cudaAvailable && !bf16Supported) {
    diagnostics.push({
      code: "bf16_unavailable",
      severity: "info",
      summary: "BF16 is unavailable. The supported fallback is FP16 with GradScaler rather than changing model dimensions.",
    });
  }

  if (!selectedProfile) {
    diagnostics.push({
      code: "profile_selection_required",
      severity: "action",
      summary: "Select one of the official 8 GB, 12 GB, or 16 GB execution profiles. Detection does not silently choose a profile for the learner.",
    });
  }

  if (selectedProfile && input.totalVramBytes != null) {
    const requiredBytes = PROFILE_VRAM_GIB[selectedProfile] * GIB;
    if (input.totalVramBytes < requiredBytes) {
      diagnostics.push({
        code: "selected_profile_exceeds_detected_vram",
        severity: "warning",
        summary: `The selected ${selectedProfile} profile exceeds detected VRAM. The selection is preserved; use a matching device or explicitly choose a lower official profile.`,
      });
    }
  }

  let status: QualificationStatus;
  if (!selectedProfile) status = "awaiting_profile_selection";
  else if (!cudaAvailable) status = "cuda_required_later";
  else if (input.totalVramBytes != null && input.totalVramBytes < PROFILE_VRAM_GIB[selectedProfile] * GIB) {
    status = "selected_profile_exceeds_detected_vram";
  } else if (!bf16Supported || input.totalVramBytes == null) status = "qualified_with_adaptations";
  else status = "qualified";

  const precision = cudaAvailable ? (bf16Supported ? "bf16" : "fp16") : "fp32";
  const gradScaler = cudaAvailable && !bf16Supported;

  return {
    status,
    selectedProfile,
    recommendedProfile: detectedRecommendation,
    detected: {
      gpuModel: input.gpuModel ?? null,
      cudaAvailable,
      cudaVersion: input.cudaVersion ?? null,
      totalVramBytes: input.totalVramBytes ?? null,
      vramGiB: detectedVramGiB,
      bf16Supported,
    },
    execution: selectedProfile
      ? {
          ...PROFILE_EXECUTION[selectedProfile],
          precision,
          gradScaler,
        }
      : {
          sequenceLength: 512 as const,
          microBatchSize: null,
          gradientAccumulationSteps: null,
          tokensPerUpdate: 32768 as const,
          activationCheckpointing: null,
          precision,
          gradScaler,
        },
    diagnostics,
  };
}

function qualificationCudaMarker(input: EnvironmentReportInput) {
  return {
    cudaAvailable: inferCudaAvailable(input),
    schemaVersion: "1",
  };
}

export async function recordEnvironmentReportForUser(userId: string, input: EnvironmentReportInput) {
  const qualification = qualifyEnvironment(input);

  return prisma.$transaction(async (tx) => {
    const environmentReport = await tx.environmentReport.create({
      data: {
        userId,
        pythonVersion: input.pythonVersion ?? null,
        pytorchVersion: input.pytorchVersion ?? null,
        operatingSystem: input.operatingSystem ?? null,
        cudaVersion: input.cudaVersion ?? null,
        gpuModel: input.gpuModel ?? null,
        totalVramBytes: input.totalVramBytes == null ? null : BigInt(input.totalVramBytes),
        bf16Supported: input.bf16Supported ?? null,
        selectedProfile: input.selectedProfile ?? null,
        fpllmVersion: input.fpllmVersion ?? null,
        repositoryCommit: input.repositoryCommit ?? null,
        reportJson: JSON.parse(JSON.stringify({
          ...input.report,
          _fpllmQualification: qualificationCudaMarker(input),
        })),
        capturedAt: new Date(input.capturedAt),
      },
    });

    const computeProfile = input.selectedProfile
      ? await tx.computeProfile.create({
          data: {
            userId,
            detectedGpu: input.gpuModel ?? null,
            vramGiB: qualification.detected.vramGiB,
            bf16Supported: qualification.detected.bf16Supported,
            cudaAvailable: qualification.detected.cudaAvailable,
            selectedProfile: input.selectedProfile,
            precision: qualification.execution.precision,
            gradScaler: qualification.execution.gradScaler,
            evidenceJson: JSON.parse(JSON.stringify({
              environmentReportId: environmentReport.id,
              qualification,
            })),
          },
        })
      : null;

    await tx.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: input.selectedProfile ? "compute.profile_recorded" : "environment.report_recorded",
        objectType: input.selectedProfile ? "compute_profile" : "environment_report",
        objectId: computeProfile?.id ?? environmentReport.id,
        dataJson: {
          environmentReportId: environmentReport.id,
          selectedProfile: input.selectedProfile ?? null,
          qualificationStatus: qualification.status,
        },
      },
    });

    return {
      environmentReportId: environmentReport.id,
      computeProfileId: computeProfile?.id ?? null,
      qualification,
    };
  });
}

function readCudaMarker(reportJson: unknown) {
  if (!reportJson || typeof reportJson !== "object" || Array.isArray(reportJson)) return undefined;
  const marker = (reportJson as Record<string, unknown>)._fpllmQualification;
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return undefined;
  const value = (marker as Record<string, unknown>).cudaAvailable;
  return typeof value === "boolean" ? value : undefined;
}

function readEnvironmentReportId(evidenceJson: unknown) {
  if (!evidenceJson || typeof evidenceJson !== "object" || Array.isArray(evidenceJson)) return null;
  const value = (evidenceJson as Record<string, unknown>).environmentReportId;
  return typeof value === "string" ? value : null;
}

export async function getLatestEnvironmentQualificationForUser(userId: string) {
  const environmentReport = await prisma.environmentReport.findFirst({
    where: { userId },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!environmentReport) return null;

  const cudaAvailable = readCudaMarker(environmentReport.reportJson);
  const selectedProfile = environmentReport.selectedProfile as HardwareProfile | null;
  const input: EnvironmentReportInput = {
    capturedAt: environmentReport.capturedAt.toISOString(),
    report: {},
    ...(environmentReport.pythonVersion == null ? {} : { pythonVersion: environmentReport.pythonVersion }),
    ...(environmentReport.pytorchVersion == null ? {} : { pytorchVersion: environmentReport.pytorchVersion }),
    ...(environmentReport.operatingSystem == null ? {} : { operatingSystem: environmentReport.operatingSystem }),
    ...(environmentReport.cudaVersion == null ? {} : { cudaVersion: environmentReport.cudaVersion }),
    ...(cudaAvailable == null ? {} : { cudaAvailable }),
    ...(environmentReport.gpuModel == null ? {} : { gpuModel: environmentReport.gpuModel }),
    ...(environmentReport.totalVramBytes == null ? {} : { totalVramBytes: Number(environmentReport.totalVramBytes) }),
    ...(environmentReport.bf16Supported == null ? {} : { bf16Supported: environmentReport.bf16Supported }),
    ...(selectedProfile == null ? {} : { selectedProfile }),
    ...(environmentReport.fpllmVersion == null ? {} : { fpllmVersion: environmentReport.fpllmVersion }),
    ...(environmentReport.repositoryCommit == null ? {} : { repositoryCommit: environmentReport.repositoryCommit }),
  };
  const qualification = qualifyEnvironment(input);
  const computeProfiles = environmentReport.selectedProfile
    ? await prisma.computeProfile.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })
    : [];
  const computeProfile = computeProfiles.find((profile) => readEnvironmentReportId(profile.evidenceJson) === environmentReport.id) ?? null;

  return { environmentReport, computeProfile, qualification };
}
