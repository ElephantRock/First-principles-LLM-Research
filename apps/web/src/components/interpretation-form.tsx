"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function InterpretationForm({ experimentId }: { experimentId: string }) {
  const router = useRouter(); const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch(`/api/v1/experiments/${experimentId}/interpretations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json(); if (!response.ok) { setError(body.code ?? "Interpretation failed"); return; } router.push("/progress/phase-1"); router.refresh();
  }
  return <form className="card" action={submit}><p className="eyebrow">Interpretation required</p>{error ? <p className="small">{error}</p> : null}<div className="form-grid">
    <div className="form-field"><label htmlFor="observation">Observation</label><textarea name="observation" id="observation" required defaultValue="Peak reserved memory accelerates as sequence length grows and the explicit S×S score tensor becomes a larger share of total memory." /></div>
    <div className="form-field"><label htmlFor="interpretation">Interpretation</label><textarea name="interpretation" id="interpretation" required placeholder="Explain the trend and the non-quadratic memory terms." /></div>
    <div className="form-field"><label htmlFor="uncertainty">Uncertainty</label><textarea name="uncertainty" id="uncertainty" required placeholder="Allocator behavior, implementation details, measurement noise..." /></div>
    <div className="form-field"><label htmlFor="nextExperiment">Next experiment</label><textarea name="nextExperiment" id="nextExperiment" /></div>
    <label>Conclusion<select name="conclusion" defaultValue="partially_supports"><option value="supports">Supports</option><option value="partially_supports">Partially supports</option><option value="does_not_support">Does not support</option><option value="inconclusive">Inconclusive</option></select></label>
    <button className="button primary" type="submit">Complete interpretation</button>
  </div></form>;
}
