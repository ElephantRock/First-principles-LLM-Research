import Link from "next/link";
import { Badge, Card } from "@fpllm/ui";
import { getLearnerSnapshot } from "@/lib/persistence";
export const dynamic = "force-dynamic";
export default async function JournalPage() {
  const snap = await getLearnerSnapshot(); const exp=snap.experiment; const entry=snap.journal;
  return <><header className="page-header"><p className="eyebrow">Research</p><h1>Research Journal</h1><p>Predictions, measurements and finalized interpretations remain connected to their evidence identity.</p></header><div className="timeline">{exp ? <div className="timeline-item"><span className="timeline-dot"/><Card><div className="split"><div><p className="eyebrow">Experiment</p><h3>{exp.displayId} · Attention memory scaling</h3><p className="small muted">State: {exp.state}</p></div><Badge tone={entry ? "positive" : "warning"}>{entry ? "Interpreted" : "Needs interpretation"}</Badge></div><Link className="secondary-button" href={`/research/journal/${exp.displayId}`}>Open entry</Link></Card></div> : null}</div></>;
}
