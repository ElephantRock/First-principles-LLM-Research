import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function GET() {
  const current = await getCurrentLearner();
  if (!current) {
    return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    mode: current.mode,
    user: {
      id: current.user.id,
      handle: current.user.handle,
      displayName: current.user.displayName,
    },
    session: current.session
      ? {
          id: current.session.id,
          expiresAt: current.session.expiresAt.toISOString(),
        }
      : null,
  });
}
