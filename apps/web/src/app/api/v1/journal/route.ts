import { prisma } from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function GET() {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const entries = await prisma.journalEntry.findMany({
    where: { userId: current.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      experiment: true,
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  return NextResponse.json({ ok: true, entries });
}
