import { experimentLockSchema } from "@fpllm/api-contracts";
import { lockExperimentForUser } from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const { id } = await context.params;
  const parsed = experimentLockSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() }, { status: 400 });
  try {
    const experiment = await lockExperimentForUser(current.user.id, { id, ...parsed.data });
    return NextResponse.json({ ok: true, experiment });
  } catch (error) {
    const code = error instanceof Error ? error.message : "EXPERIMENT_LOCK_FAILED";
    const status = code === "EXPERIMENT_ALREADY_LOCKED" ? 409 : 404;
    return NextResponse.json({ ok: false, code }, { status });
  }
}
