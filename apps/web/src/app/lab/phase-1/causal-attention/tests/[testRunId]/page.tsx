import Link from "next/link";
import { getTestRunByIdForUser } from "@fpllm/db";
import { Badge, Card } from "@fpllm/ui";
import { notFound, redirect } from "next/navigation";
import { getCurrentLearner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TestRunPage({ params }: { params: Promise<{ testRunId: string }> }) {
  const current = await getCurrentLearner();
  if (!current) redirect("/auth/sign-in");

  const { testRunId } = await params;
  const run = await getTestRunByIdForUser(current.user.id, testRunId);
  if (!run) notFound();

  const publicResults = run.results.filter((result) => result.visibility === "public");
  const hiddenResults = run.results.filter((result) => result.visibility === "hidden");
  const passed = run.results.length > 0 && run.results.every((result) => result.passed);

  return <>
    <header className="page-header">
      <p className="eyebrow">Test run {run.id.slice(0, 8)}</p>
      <h1>{passed ? "Implementation gate passed." : run.state === "failed" ? "Needs revision." : "Qualification evidence"}</h1>
      <p>Persisted evidence for your commit <span className="mono">{run.submission.commitSha.slice(0, 12)}</span>.</p>
    </header>

    <div className="grid-2">
      <Card>
        <p className="eyebrow">Public tests</p>
        <h2>{publicResults.filter((result) => result.passed).length} / {publicResults.length}</h2>
        <Badge tone={publicResults.length > 0 && publicResults.every((result) => result.passed) ? "positive" : "negative"}>
          {publicResults.length > 0 && publicResults.every((result) => result.passed) ? "Pass" : "Fail"}
        </Badge>
      </Card>
      <Card>
        <p className="eyebrow">Hidden tests</p>
        <h2>{hiddenResults.filter((result) => result.passed).length} / {hiddenResults.length}</h2>
        <Badge tone={hiddenResults.length > 0 && hiddenResults.every((result) => result.passed) ? "positive" : "negative"}>
          {hiddenResults.length > 0 && hiddenResults.every((result) => result.passed) ? "Pass" : "Fail"}
        </Badge>
      </Card>
    </div>

    {passed ? <Card className="emphasis">
      <p className="eyebrow">Next evidence</p>
      <h2>Attention memory-scaling experiment</h2>
      <Link className="button primary" href="/experiments/attention-memory-scaling/new">Start experiment</Link>
    </Card> : <Card>
      <p className="eyebrow">Diagnostic evidence</p>
      {run.results.filter((result) => !result.passed).map((result) => <div className="diagnostic" key={result.id}>
        <h3>{result.invariantId ?? result.groupId}</h3>
        <p>{result.summary}</p>
      </div>)}
      {run.results.length === 0 ? <p>No final invariant evidence has been persisted yet.</p> : null}
    </Card>}
  </>;
}
