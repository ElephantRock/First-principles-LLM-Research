import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function GET() {
  const current = await getCurrentLearner();
  if (!current) {
    return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: current.user.id,
      handle: current.user.handle,
      displayName: current.user.displayName,
    },
    session: {
      id: current.session.id,
      expiresAt: current.session.expiresAt.toISOString(),
    },
  });
}
