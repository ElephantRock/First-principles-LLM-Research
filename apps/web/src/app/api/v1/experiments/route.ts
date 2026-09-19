import { experimentCreateSchema } from "@fpllm/api-contracts";
import { createVerifiedExperimentForDemo } from "@fpllm/db";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const parsed = experimentCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const experiment = await createVerifiedExperimentForDemo(parsed.data.submissionId);
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
