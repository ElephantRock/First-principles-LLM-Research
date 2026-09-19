import { getCausalAttentionMastery } from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function GET(_: Request, context: { params: Promise<{ unitId: string }> }) {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const { unitId } = await context.params;
  if (unitId !== "phase1-causal-attention") {
    return NextResponse.json({ ok: false, code: "UNIT_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, mastery: await getCausalAttentionMastery(current.user.id) });
}
