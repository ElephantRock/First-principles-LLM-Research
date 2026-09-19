import { prisma } from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const { id } = await context.params;
  const experiment = await prisma.experiment.findFirst({
    where: { id, userId: current.user.id },
    include: {
      runs: { include: { metrics: true }, orderBy: { createdAt: "desc" } },
      artifacts: true,
      journalEntry: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
    },
  });
  if (!experiment) return NextResponse.json({ ok: false, code: "EXPERIMENT_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, experiment }, { status: 200 });
}
