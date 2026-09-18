import { prisma, getDemoUser } from "@fpllm/db";
import { NextResponse } from "next/server";
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const user = await getDemoUser();
  const experiment = await prisma.experiment.findFirst({ where: { id, userId: user.id }, include: { runs: { include: { metrics: true }, orderBy: { createdAt: "desc" } }, artifacts: true, journalEntry: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } } } });
  if (!experiment) return NextResponse.json({ ok: false, code: "EXPERIMENT_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, experiment }, { status: 200 });
}
