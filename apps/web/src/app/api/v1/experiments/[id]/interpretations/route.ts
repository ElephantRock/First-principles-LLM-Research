import { interpretationCreateSchema } from "@fpllm/api-contracts";
import { finalizeInterpretationForUser } from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const { id } = await context.params;
  const parsed = interpretationCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await finalizeInterpretationForUser(current.user.id, {
      experimentId: id,
      observation: parsed.data.observation,
      interpretation: parsed.data.interpretation,
      uncertainty: parsed.data.uncertainty,
      conclusion: parsed.data.conclusion,
      ...(parsed.data.nextExperiment === undefined ? {} : { nextExperiment: parsed.data.nextExperiment }),
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERPRETATION_FAILED";
    return NextResponse.json({ ok: false, code }, { status: code.includes("NOT_FOUND") ? 404 : 409 });
  }
}
