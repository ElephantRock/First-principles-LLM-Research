import Link from "next/link";
import { Badge, Card } from "@fpllm/ui";
import { getCausalAttentionContent } from "@/lib/course-content";
import { getLearnerSnapshot, shortSha } from "@/lib/persistence";

export const dynamic = "force-dynamic";
export default async function CausalAttentionLabPage() {
  const [content, snap] = await Promise.all([getCausalAttentionContent(), getLearnerSnapshot()]);
  return <><header className="page-header"><p className="eyebrow">A2 · Phase 1 Lab</p><h1>{content.unit.title}</h1><p>Requirements come from versioned course YAML; submission identity comes from durable persistence.</p><div className="page-actions"><Badge tone="research">Lab v{content.lab.version}</Badge><Badge>{snap.compute?.selectedProfile ?? "profile unknown"}</Badge></div></header>
    <div className="grid-2"><Card><p className="eyebrow">Requirements</p><ul className="requirement-list">{content.lab.requirements.map((item,i)=><li className="requirement-item" key={item}><span className="requirement-state">○</span><span>{item}</span><span className="dim">R{i+1}</span></li>)}</ul></Card><Card><p className="eyebrow">Repository identity</p><p><strong>{snap.repository ? `${snap.repository.owner}/${snap.repository.name}` : "No repository"}</strong></p><p className="small muted">Commit <span className="mono">{shortSha(snap.submission?.commitSha)}</span></p><p className="small muted">State {snap.submission?.state ?? "not submitted"}</p></Card></div>
    <Card><p className="eyebrow">Constraints</p><p>{content.lab.prohibited.join(" · ")}</p><div className="command-block"><code>{content.lab.publicTestCommand}</code><button className="secondary-button" type="button">Copy</button></div></Card>
    {snap.submission ? <Card className="emphasis"><div className="split"><div><p className="eyebrow">Persisted submission</p><h3>{shortSha(snap.submission.commitSha)} · {snap.submission.state}</h3></div><Link className="button primary" href={`/lab/phase-1/causal-attention/submission/${snap.submission.id}`}>Open submission</Link></div></Card> : null}
  </>;
}
