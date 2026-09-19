"use client";

import { useState, type FormEvent } from "react";

export function SubmissionCreateForm({
  repositoryId,
  defaultBranch,
  labVersion,
}: {
  repositoryId: string;
  defaultBranch: string;
  labVersion: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const branch = String(form.get("branch") ?? "").trim();
    const commit = String(form.get("commit") ?? "").trim().toLowerCase();

    try {
      const response = await fetch("/api/v1/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repositoryId,
          branch,
          commit,
          labId: "phase1-causal-attention-lab",
          labVersion,
        }),
      });
      const body = await response.json() as {
        ok: boolean;
        code?: string;
        submission?: { id: string };
      };
      if (!response.ok || !body.ok || !body.submission) {
        throw new Error(body.code ?? "SUBMISSION_CREATE_FAILED");
      }
      window.location.assign(`/lab/phase-1/causal-attention/submission/${body.submission.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SUBMISSION_CREATE_FAILED");
      setBusy(false);
    }
  }

  return <form className="form-grid" onSubmit={submit}>
    <div className="form-field">
      <label htmlFor="submission-branch">Branch</label>
      <input id="submission-branch" name="branch" required maxLength={255} defaultValue={defaultBranch} />
    </div>
    <div className="form-field">
      <label htmlFor="submission-commit">Full 40-character Git commit SHA</label>
      <input
        id="submission-commit"
        name="commit"
        className="mono"
        required
        minLength={40}
        maxLength={40}
        pattern="[0-9a-fA-F]{40}"
        autoComplete="off"
        spellCheck={false}
        placeholder="0123456789abcdef0123456789abcdef01234567"
      />
      <p className="small muted">The server resolves this exact SHA through the bound GitHub App installation before evidence is created.</p>
    </div>
    {error ? <div className="callout negative" role="alert"><strong>Submission was not queued.</strong><p className="small mono">{error}</p></div> : null}
    <button className="button primary" type="submit" disabled={busy}>{busy ? "Verifying commit…" : "Submit immutable commit"}</button>
  </form>;
}
