import { interpretationCreateSchema } from "@fpllm/api-contracts";
import { finalizeInterpretationForDemo } from "@fpllm/db";
import { NextResponse } from "next/server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = interpretationCreateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() }, { status: 400 });
  try {
    const result = await finalizeInterpretationForDemo({ experimentId: id, ...parsed.data });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERPRETATION_FAILED";
    return NextResponse.json({ ok: false, code }, { status: code.includes("NOT_FOUND") ? 404 : 409 });
  }
}
