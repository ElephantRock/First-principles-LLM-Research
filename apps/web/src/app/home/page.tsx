import Link from "next/link";
import { Badge, Card } from "@fpllm/ui";
import { getLearnerSnapshot, shortSha } from "@/lib/persistence";

export const dynamic = "force-dynamic";
export default async function HomePage() {
  const snap = await getLearnerSnapshot();
  const exp = snap.experiment;
  const nextHref = !exp || exp.state === "draft" ? "/experiments/attention-memory-scaling/new" : `/experiments/attention-memory-scaling/${exp.displayId}`;
  const nextLabel = !exp || exp.state === "draft" ? "Lock experiment" : exp.state === "interpreted" ? "Review evidence" : "Continue experiment";
  const masteryCount = [snap.mastery.conceptual,snap.mastery.implementation,snap.mastery.publicTests,snap.mastery.hiddenTests,snap.mastery.experiment,snap.mastery.interpretation].filter(v=>v==="passed").length;
  return <>
    <header className="page-header"><p className="eyebrow">Phase 1 · Build</p><h1>Continue the evidence loop.</h1><p>The current state is read from PostgreSQL evidence, not browser completion flags.</p></header>
    <Card className="emphasis"><div className="split"><div><Badge tone={snap.mastery.overall === "mastered" ? "positive" : "warning"}>{snap.mastery.overall.replaceAll("_", " ")}</Badge><h2 style={{marginTop:12}}>Causal Grouped-Query Attention</h2><p className="muted">Mastery evidence: {masteryCount} / 6 dimensions satisfied.</p></div><Link className="button primary" href={nextHref}>{nextLabel}</Link></div></Card>
    <div className="grid-2" style={{marginTop:14}}><Card><p className="eyebrow">Latest evidence</p><h3>{exp?.displayId ?? "No experiment yet"} · Attention memory scaling</h3><p className="muted">State: {exp?.state ?? "not created"} · commit <span className="mono">{shortSha(snap.submission?.commitSha)}</span></p></Card><Card><p className="eyebrow">Compute profile</p><h3>{snap.compute?.selectedProfile ?? "—"}</h3><p className="muted">{snap.compute?.detectedGpu ?? "No GPU report"} · {snap.compute?.precision?.toUpperCase() ?? "—"}</p><Link className="secondary-button" href="/setup/compute">View setup</Link></Card></div>
  </>;
}
