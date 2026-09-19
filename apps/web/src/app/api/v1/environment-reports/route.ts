import { environmentReportSchema } from "@fpllm/api-contracts";
import { prisma } from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function POST(request: Request) {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const parsed = environmentReportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const row = await prisma.environmentReport.create({
    data: {
      userId: current.user.id,
      pythonVersion: parsed.data.pythonVersion ?? null,
      pytorchVersion: parsed.data.pytorchVersion ?? null,
      operatingSystem: parsed.data.operatingSystem ?? null,
      cudaVersion: parsed.data.cudaVersion ?? null,
      gpuModel: parsed.data.gpuModel ?? null,
      totalVramBytes: parsed.data.totalVramBytes == null ? null : BigInt(parsed.data.totalVramBytes),
      bf16Supported: parsed.data.bf16Supported ?? null,
      selectedProfile: parsed.data.selectedProfile ?? null,
      fpllmVersion: parsed.data.fpllmVersion ?? null,
      repositoryCommit: parsed.data.repositoryCommit ?? null,
      reportJson: JSON.parse(JSON.stringify(parsed.data.report)),
      capturedAt: new Date(parsed.data.capturedAt),
    },
  });

  return NextResponse.json({ ok: true, environmentReportId: row.id }, { status: 201 });
}
