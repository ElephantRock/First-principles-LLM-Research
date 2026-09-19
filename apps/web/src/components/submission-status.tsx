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

const ACTIVE_RUN_STATES = new Set(["preparing", "leased", "running_public", "running_hidden", "finalizing"]);
const EVIDENCE_STATES = new Set(["passed", "needs_revision", "failed"]);

function displayStage(status: SubmissionStatusPayload): {
  label: string;
  badge: string;
  tone: "neutral" | "positive" | "warning" | "negative";
} {
  if (status.submission.state === "passed") return { label: "passed", badge: "passed", tone: "positive" };
  if (status.submission.state === "needs_revision") return { label: "needs revision", badge: "needs_revision", tone: "negative" };
  if (status.submission.state === "failed") return { label: "failed", badge: "failed", tone: "negative" };

  const runState = status.testRun?.state;
  if (runState === "infrastructure_error") {
    return { label: "infrastructure error", badge: "infrastructure_error", tone: "negative" };
  }
  if (runState === "queued") return { label: "queued", badge: "queued", tone: "warning" };
  if (runState && ACTIVE_RUN_STATES.has(runState)) return { label: "running", badge: runState, tone: "warning" };
  if (status.submission.state === "submitted") return { label: "submitted", badge: "submitted", tone: "warning" };
  return { label: status.submission.state.replaceAll("_", " "), badge: status.submission.state, tone: "neutral" };
}

function terminal(status: SubmissionStatusPayload) {
  return EVIDENCE_STATES.has(status.submission.state) || status.testRun?.state === "infrastructure_error";
}

export function SubmissionStatus({ initial }: { initial: SubmissionStatusPayload }) {
  const [status, setStatus] = useState(initial);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    if (terminal(status)) return;
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
  }, [status.submission.id, status.submission.state, status.testRun?.state]);

  const run = status.testRun;
  const stage = displayStage(status);
  const hasEvidence = EVIDENCE_STATES.has(status.submission.state);

  return <Card className="emphasis">
    <div className="split">
      <div>
        <p className="eyebrow">Qualification status</p>
        <h2>{stage.label}</h2>
        <p className="small muted">Commit <span className="mono">{status.submission.commitSha.slice(0, 12)}</span></p>
      </div>
      <Badge tone={stage.tone}>{stage.badge}</Badge>
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

    {!terminal(status) ? <p className="small muted">This view refreshes persisted status every two seconds while qualification is active.</p> : null}
    {run?.state === "infrastructure_error" ? <div className="callout negative" role="status">
      <strong>Qualification infrastructure stopped after bounded retries.</strong>
      <p className="small">Your commit remains the evidence identity. Re-submit only after the execution service is healthy.</p>
    </div> : null}
    {pollError ? <p className="small muted" role="status">Live refresh paused: <span className="mono">{pollError}</span></p> : null}

    {run && hasEvidence
      ? <div className="page-actions"><Link className="button primary" href={`/lab/phase-1/causal-attention/tests/${run.id}`}>View evidence</Link></div>
      : null}
  </Card>;
}
