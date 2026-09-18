"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export function ArtifactImportForm({ experimentId, commit }: { experimentId: string; commit: string }) {
  const router = useRouter();
  const sample = useMemo(() => JSON.stringify({ schemaVersion: "1", experimentId, experimentType: "attention_memory_scaling", submissionCommit: commit, runs: [
    { sequenceLength: 128, peakAllocatedBytes: 1299227607, peakReservedBytes: 1524713390, tokensPerSecond: 18204, stepSeconds: 0.7, status: "complete" },
    { sequenceLength: 256, peakAllocatedBytes: 1664299827, peakReservedBytes: 1900523028, tokensPerSecond: 16581, stepSeconds: 1.1, status: "complete" },
    { sequenceLength: 512, peakAllocatedBytes: 2834678415, peakReservedBytes: 3146063053, tokensPerSecond: 11207, stepSeconds: 2.9, status: "complete" },
    { sequenceLength: 1024, peakAllocatedBytes: 7666514166, peakReservedBytes: 8170436362, tokensPerSecond: 4322, stepSeconds: 7.6, status: "complete" }
  ] }, null, 2), [experimentId, commit]);
  const [value, setValue] = useState(sample); const [message, setMessage] = useState<string | null>(null);
  async function submit() { setMessage(null); let parsed: unknown; try { parsed = JSON.parse(value); } catch { setMessage("Artifact is not valid JSON."); return; }
    const response = await fetch(`/api/v1/experiments/${experimentId}/artifacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) });
    const body = await response.json(); if (!response.ok) { setMessage(body.code ?? "Import failed"); return; } setMessage(`Imported evidence ${body.sha256.slice(0, 12)}…`); router.refresh(); }
  return <div className="card"><p className="eyebrow">Import result JSON</p><textarea className="mono" rows={14} value={value} onChange={(e) => setValue(e.target.value)} />{message ? <p className="small">{message}</p> : null}<button className="button primary" type="button" onClick={submit}>Validate and import</button></div>;
}
