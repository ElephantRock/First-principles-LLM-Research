import { getSubmissionByIdForUser } from "@fpllm/db";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await getCurrentLearner();
  if (!current) {
    return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  const { id } = await params;
  const submission = await getSubmissionByIdForUser(current.user.id, id);
  if (!submission) {
    return NextResponse.json({ ok: false, code: "SUBMISSION_NOT_FOUND" }, { status: 404 });
  }

  const run = submission.testRuns[0] ?? null;
  const publicResults = run?.results.filter((result) => result.visibility === "public") ?? [];
  const hiddenResults = run?.results.filter((result) => result.visibility === "hidden") ?? [];

  return NextResponse.json({
    ok: true,
    status: {
      submission: {
        id: submission.id,
        state: submission.state,
        commitSha: submission.commitSha,
        branch: submission.branch,
      },
      testRun: run ? {
        id: run.id,
        state: run.state,
        publicPassed: publicResults.filter((result) => result.passed).length,
        publicTotal: publicResults.length,
        hiddenPassed: hiddenResults.filter((result) => result.passed).length,
        hiddenTotal: hiddenResults.length,
      } : null,
    },
  });
}
