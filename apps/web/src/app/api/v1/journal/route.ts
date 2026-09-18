import { getDemoUser, prisma } from "@fpllm/db";
import { NextResponse } from "next/server";
export async function GET() {
  const user = await getDemoUser();
  const entries = await prisma.journalEntry.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, include: { experiment: true, versions: { orderBy: { version: "desc" }, take: 1 } } });
  return NextResponse.json({ ok: true, entries });
}
