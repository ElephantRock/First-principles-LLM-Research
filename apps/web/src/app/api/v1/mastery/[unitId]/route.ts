import { getCausalAttentionMastery, getDemoUser } from "@fpllm/db";
import { NextResponse } from "next/server";
export async function GET(_: Request, context: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await context.params;
  if (unitId !== "phase1-causal-attention") return NextResponse.json({ ok: false, code: "UNIT_NOT_FOUND" }, { status: 404 });
  const user = await getDemoUser();
  return NextResponse.json({ ok: true, mastery: await getCausalAttentionMastery(user.id) });
}
