import { experimentCreateSchema } from "@fpllm/api-contracts";
import { createVerifiedExperimentForUser } from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function POST(request: Request) {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const parsed = experimentCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const experiment = await createVerifiedExperimentForUser(current.user.id, parsed.data.submissionId);
    return NextResponse.json({ ok: true, experiment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "EXPERIMENT_CREATE_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 409 },
    );
  }
}
