import { createHash } from "node:crypto";
import { experimentArtifactSchema } from "@fpllm/api-contracts";
import { importExperimentArtifactForDemo } from "@fpllm/db";
import { NextResponse } from "next/server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const raw: unknown = await request.json();
  const parsed = experimentArtifactSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "ARTIFACT_SCHEMA_INVALID", errors: parsed.error.flatten() }, { status: 400 });
  const canonical = JSON.stringify(parsed.data);
  const sha256 = createHash("sha256").update(canonical).digest("hex");
  try {
    const result = await importExperimentArtifactForDemo({
      experimentDbId: id,
      artifact: parsed.data,
      sha256,
      byteSize: Buffer.byteLength(canonical),
    });
    return NextResponse.json({ ok: true, sha256, ...result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ARTIFACT_IMPORT_FAILED";
    const status = code.includes("MISMATCH") ? 409 : code.includes("NOT_FOUND") ? 404 : 409;
    return NextResponse.json({ ok: false, code }, { status });
  }
}
