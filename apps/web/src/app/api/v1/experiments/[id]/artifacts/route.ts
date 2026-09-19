import { createHash } from "node:crypto";
import { experimentArtifactSchema } from "@fpllm/api-contracts";
import { importExperimentArtifactForUser } from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const { id } = await context.params;
  const raw: unknown = await request.json();
  const parsed = experimentArtifactSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "ARTIFACT_SCHEMA_INVALID", errors: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const canonical = JSON.stringify(parsed.data);
  const sha256 = createHash("sha256").update(canonical).digest("hex");
  const artifact = {
    schemaVersion: parsed.data.schemaVersion,
    experimentId: parsed.data.experimentId,
    experimentType: parsed.data.experimentType,
    submissionCommit: parsed.data.submissionCommit,
    ...(parsed.data.environmentReportId === undefined ? {} : { environmentReportId: parsed.data.environmentReportId }),
    runs: parsed.data.runs.map((run) => ({
      sequenceLength: run.sequenceLength,
      status: run.status,
      ...(run.peakAllocatedBytes === undefined ? {} : { peakAllocatedBytes: run.peakAllocatedBytes }),
      ...(run.peakReservedBytes === undefined ? {} : { peakReservedBytes: run.peakReservedBytes }),
      ...(run.tokensPerSecond === undefined ? {} : { tokensPerSecond: run.tokensPerSecond }),
      ...(run.stepSeconds === undefined ? {} : { stepSeconds: run.stepSeconds }),
      ...(run.failureCode === undefined ? {} : { failureCode: run.failureCode }),
    })),
  };

  try {
    const result = await importExperimentArtifactForUser(current.user.id, {
      experimentDbId: id,
      artifact,
      sha256,
      byteSize: Buffer.byteLength(canonical),
    });
    return NextResponse.json({ ok: true, sha256, ...result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ARTIFACT_IMPORT_FAILED";
    const status = code.includes("MISMATCH") ? 409 : code.includes("NOT_FOUND") ? 404 : 409;
    return NextResponse.json({ ok: false, code }, { status });
  }
}
