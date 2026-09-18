import { submissionCreateSchema } from "@fpllm/api-contracts";
import { createSubmissionForDemo } from "@fpllm/db";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const parsed = submissionCreateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() }, { status: 400 });
  try {
    const submission = await createSubmissionForDemo({
      repositoryId: parsed.data.repositoryId,
      branch: parsed.data.branch,
      commitSha: parsed.data.commit.toLowerCase(),
      labVersion: parsed.data.labVersion,
    });
    return NextResponse.json({ ok: true, submission }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, code: "SUBMISSION_CREATE_FAILED", message: error instanceof Error ? error.message : "Unknown error" }, { status: 409 });
  }
}
