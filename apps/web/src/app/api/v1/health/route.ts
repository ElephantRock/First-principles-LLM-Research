import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "fpllm-web",
    apiVersion: "v1",
    prototype: "causal-attention-v0.2",
    persistence: "postgresql-prisma7",
  });
}
