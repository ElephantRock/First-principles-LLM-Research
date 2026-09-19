import { getSubmissionByIdForUser } from "@fpllm/db";
import { Card } from "@fpllm/ui";
import { notFound, redirect } from "next/navigation";
import { SubmissionStatus } from "@/components/submission-status";
import { getCurrentLearner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SubmissionPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const current = await getCurrentLearner();
  if (!current) redirect("/auth/sign-in");

  const { submissionId } = await params;
  const submission = await getSubmissionByIdForUser(current.user.id, submissionId);
  if (!submission) notFound();

  const run = submission.testRuns[0] ?? null;
  const publicResults = run?.results.filter((result) => result.visibility === "public") ?? [];
  const hiddenResults = run?.results.filter((result) => result.visibility === "hidden") ?? [];
  const initial = {
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
  };

  return <>
    <header className="page-header">
      <p className="eyebrow">Submission {submission.id.slice(0, 8)}</p>
      <h1>Immutable commit qualification</h1>
      <p>This attempt is scoped to your learner identity and identified by repository, lab version, and full Git SHA.</p>
    </header>

    <Card>
      <div className="table-wrap">
        <table>
          <tbody>
            <tr><th>Repository</th><td>{submission.repository.owner}/{submission.repository.name}</td></tr>
            <tr><th>Branch</th><td className="mono">{submission.branch}</td></tr>
            <tr><th>Commit</th><td className="mono">{submission.commitSha}</td></tr>
            <tr><th>Course / Lab</th><td>{submission.courseVersion.version} / {submission.labVersion}</td></tr>
          </tbody>
        </table>
      </div>
    </Card>

    <SubmissionStatus initial={initial} />
  </>;
}
