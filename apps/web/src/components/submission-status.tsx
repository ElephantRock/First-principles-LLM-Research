"use client";

import Link from "next/link";
import { Badge, Card } from "@fpllm/ui";
import { useEffect, useState } from "react";

type SubmissionStatusPayload = {
  submission: {
    id: string;
    state: string;
    commitSha: string;
    branch: string;
  };
  testRun: null | {
    id: string;
    state: string;
    publicPassed: number;
    publicTotal: number;
    hiddenPassed: number;
    hiddenTotal: number;
  };
};

function tone(state: string): "neutral" | "positive" | "warning" | "negative" {
  if (state === "passed") return "positive";
  if (state === "needs_revision" || state === "failed") return "negative";
  if (state === "submitted" || state === "queued" || state === "testing" || state === "running" || state === "finalizing") return "warning";
  return "neutral";
}

function terminal(state: string) {
  return state === "passed" || state === "needs_revision" || state === "failed";
}

export function SubmissionStatus({ initial }: { initial: SubmissionStatusPayload }) {
  const [status, setStatus] = useState(initial);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    if (terminal(status.submission.state)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/v1/submissions/${status.submission.id}`, { cache: "no-store" });
        const body = await response.json() as { ok: boolean; code?: string; status?: SubmissionStatusPayload };
        if (!response.ok || !body.ok || !body.status) throw new Error(body.code ?? "STATUS_FETCH_FAILED");
        setStatus(body.status);
        setPollError(null);
      } catch (error) {
        setPollError(error instanceof Error ? error.message : "STATUS_FETCH_FAILED");
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [status.submission.id, status.submission.state]);

  const run = status.testRun;
  return <Card className="emphasis">
    <div className="split">
      <div>
        <p className="eyebrow">Qualification status</p>
        <h2>{status.submission.state.replaceAll("_", " ")}</h2>
        <p className="small muted">Commit <span className="mono">{status.submission.commitSha.slice(0, 12)}</span></p>
      </div>
      <Badge tone={tone(status.submission.state)}>{status.submission.state}</Badge>
    </div>

    {run ? <div className="table-wrap">
      <table>
        <tbody>
          <tr><th>Test run</th><td className="mono">{run.id.slice(0, 8)}</td></tr>
          <tr><th>Worker state</th><td>{run.state}</td></tr>
          <tr><th>Public evidence</th><td>{run.publicPassed} / {run.publicTotal}</td></tr>
          <tr><th>Hidden evidence</th><td>{run.hiddenPassed} / {run.hiddenTotal}</td></tr>
        </tbody>
      </table>
    </div> : <p>No test run has been created.</p>}

    {!terminal(status.submission.state) ? <p className="small muted">This view refreshes persisted status every two seconds while qualification is active.</p> : null}
    {pollError ? <p className="small muted" role="status">Live refresh paused: <span className="mono">{pollError}</span></p> : null}

    {run && terminal(status.submission.state)
      ? <div className="page-actions"><Link className="button primary" href={`/lab/phase-1/causal-attention/tests/${run.id}`}>View evidence</Link></div>
      : null}
  </Card>;
}
