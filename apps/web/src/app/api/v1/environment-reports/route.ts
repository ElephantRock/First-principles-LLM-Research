import { environmentReportSchema } from "@fpllm/api-contracts";
import {
  getLatestEnvironmentQualificationForUser,
  recordEnvironmentReportForUser,
  type EnvironmentReportInput,
} from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

function toEnvironmentReportInput(input: ReturnType<typeof environmentReportSchema.parse>): EnvironmentReportInput {
  return {
    capturedAt: input.capturedAt,
    report: input.report,
    ...(input.pythonVersion === undefined ? {} : { pythonVersion: input.pythonVersion }),
    ...(input.pytorchVersion === undefined ? {} : { pytorchVersion: input.pytorchVersion }),
    ...(input.operatingSystem === undefined ? {} : { operatingSystem: input.operatingSystem }),
    ...(input.cudaVersion === undefined ? {} : { cudaVersion: input.cudaVersion }),
    ...(input.cudaAvailable === undefined ? {} : { cudaAvailable: input.cudaAvailable }),
    ...(input.gpuModel === undefined ? {} : { gpuModel: input.gpuModel }),
    ...(input.totalVramBytes === undefined ? {} : { totalVramBytes: input.totalVramBytes }),
    ...(input.bf16Supported === undefined ? {} : { bf16Supported: input.bf16Supported }),
    ...(input.selectedProfile === undefined ? {} : { selectedProfile: input.selectedProfile }),
    ...(input.fpllmVersion === undefined ? {} : { fpllmVersion: input.fpllmVersion }),
    ...(input.repositoryCommit === undefined ? {} : { repositoryCommit: input.repositoryCommit }),
  };
}

export async function GET() {
  const current = await getCurrentLearner();
  if (!current) {
    return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  const latest = await getLatestEnvironmentQualificationForUser(current.user.id);
  if (!latest) return NextResponse.json({ ok: true, environment: null });

  return NextResponse.json({
    ok: true,
    environment: {
      environmentReportId: latest.environmentReport.id,
      computeProfileId: latest.computeProfile?.id ?? null,
      capturedAt: latest.environmentReport.capturedAt.toISOString(),
      qualification: latest.qualification,
    },
  });
}

export async function POST(request: Request) {
  const current = await getCurrentLearner();
  if (!current) {
    return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  const parsed = environmentReportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await recordEnvironmentReportForUser(current.user.id, toEnvironmentReportInput(parsed.data));
  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}
