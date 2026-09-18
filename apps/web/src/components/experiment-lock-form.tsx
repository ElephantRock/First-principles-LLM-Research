"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ExperimentLockForm(props: { experimentId: string; displayId: string; commit: string; initialHypothesis?: string | null; initialPrediction?: string | null; locked: boolean }) {
  const router = useRouter();
  const [locked, setLocked] = useState(props.locked);
  const [confirming, setConfirming] = useState(false);
  const [hypothesis, setHypothesis] = useState(props.initialHypothesis ?? "Once attention-score storage dominates, peak memory will include a quadratic component in sequence length.");
  const [prediction, setPrediction] = useState(props.initialPrediction ?? "Doubling sequence length should move the score-tensor contribution toward 4× while total reserved VRAM deviates because other memory terms are not quadratic.");
  const [error, setError] = useState<string | null>(null);
  const ready = hypothesis.trim().length >= 20 && prediction.trim().length >= 20;

  async function lock() {
    setError(null);
    const response = await fetch(`/api/v1/experiments/${props.experimentId}/lock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hypothesis, prediction }) });
    const body = await response.json();
    if (!response.ok) { setError(body.code ?? "Unable to lock experiment"); return; }
    setLocked(true); setConfirming(false); router.refresh();
  }

  return <div className="form-grid">
    {locked ? <div className="lock-banner"><strong>Locked before run.</strong><span>Hypothesis and prediction are preserved as pre-run evidence for {props.displayId}.</span></div> : null}
    {error ? <div className="callout negative"><strong>Lock failed.</strong><p className="small">{error}</p></div> : null}
    <div className="form-field"><label htmlFor="hypothesis">Hypothesis</label><textarea id="hypothesis" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} disabled={locked} /></div>
    <div className="form-field"><label htmlFor="prediction">Prediction</label><textarea id="prediction" value={prediction} onChange={(e) => setPrediction(e.target.value)} disabled={locked} /></div>
    <div className="card"><p className="eyebrow">Controlled variables</p><p className="small muted">Implementation commit <span className="mono">{props.commit.slice(0, 7)}</span> · model fixed · batch fixed · precision fixed</p><p><strong>Sequence lengths:</strong> 128, 256, 512, 1024</p></div>
    {!locked && !confirming ? <button className="button primary" disabled={!ready} onClick={() => setConfirming(true)} type="button">Lock experiment</button> : null}
    {confirming && !locked ? <div className="callout research"><strong>Lock experiment?</strong><p className="small muted">Rewriting this prediction after measurement requires a new experiment.</p><div className="page-actions"><button className="secondary-button" type="button" onClick={() => setConfirming(false)}>Cancel</button><button className="button primary" type="button" onClick={lock}>Lock</button></div></div> : null}
    {locked ? <div className="command-block"><code>PYTHONPATH=src python scripts/memory_probe.py --experiment {props.displayId}</code><button type="button" className="secondary-button">Copy</button></div> : null}
  </div>;
}
