import { environmentReportSchema } from "@fpllm/api-contracts";
import {
  getLatestEnvironmentQualificationForUser,
  recordEnvironmentReportForUser,
} from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

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

  const result = await recordEnvironmentReportForUser(current.user.id, parsed.data);
  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}
