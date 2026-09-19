import Link from "next/link";
import { Badge, Card } from "@fpllm/ui";
import { getCausalAttentionContent } from "@/lib/course-content";
import { getLearnerSnapshot, shortSha } from "@/lib/persistence";
import { SubmissionCreateForm } from "@/components/submission-create-form";

export const dynamic = "force-dynamic";

export default async function CausalAttentionLabPage() {
  const [content, snap] = await Promise.all([getCausalAttentionContent(), getLearnerSnapshot()]);

  return <>
    <header className="page-header">
      <p className="eyebrow">A2 · Phase 1 Lab</p>
      <h1>{content.unit.title}</h1>
      <p>Requirements come from versioned course YAML; qualification evidence is bound to an immutable Git commit.</p>
      <div className="page-actions">
        <Badge tone="research">Lab v{content.lab.version}</Badge>
        <Badge>{snap.compute?.selectedProfile ?? "profile not selected"}</Badge>
      </div>
    </header>

    <div className="grid-2">
      <Card>
        <p className="eyebrow">Requirements</p>
        <ul className="requirement-list">
          {content.lab.requirements.map((item, index) => <li className="requirement-item" key={item}>
            <span className="requirement-state">○</span><span>{item}</span><span className="dim">R{index + 1}</span>
          </li>)}
        </ul>
      </Card>
      <Card>
        <p className="eyebrow">Repository identity</p>
        <p><strong>{snap.repository ? `${snap.repository.owner}/${snap.repository.name}` : "No repository bound"}</strong></p>
        <p className="small muted">Latest commit <span className="mono">{shortSha(snap.submission?.commitSha)}</span></p>
        <p className="small muted">Latest state {snap.submission?.state ?? "not submitted"}</p>
        {!snap.repository ? <Link className="secondary-button" href="/setup/repository">Bind repository</Link> : null}
      </Card>
    </div>

    <Card>
      <p className="eyebrow">Constraints</p>
      <p>{content.lab.prohibited.join(" · ")}</p>
      <div className="command-block"><code>{content.lab.publicTestCommand}</code><button className="secondary-button" type="button">Copy</button></div>
    </Card>

    {snap.repository ? <Card className="emphasis">
      <p className="eyebrow">Submit evidence</p>
      <h2>Repository → Branch → Commit → Qualification</h2>
      <p>The branch is recorded for provenance, but the evidence identity is the exact 40-character commit SHA. Mutable branch heads are never used as submission identity.</p>
      <SubmissionCreateForm
        repositoryId={snap.repository.id}
        defaultBranch={snap.repository.defaultBranch ?? "main"}
        labVersion={content.lab.version}
      />
    </Card> : <Card className="emphasis">
      <p className="eyebrow">Repository required</p>
      <h2>Bind a GitHub repository before submitting.</h2>
      <p>The binding proves repository access separately from your GitHub sign-in identity.</p>
      <Link className="button primary" href="/setup/repository">Set up repository</Link>
    </Card>}

    {snap.submission ? <Card>
      <div className="split">
        <div>
          <p className="eyebrow">Latest persisted submission</p>
          <h3>{shortSha(snap.submission.commitSha)} · {snap.submission.state}</h3>
        </div>
        <Link className="button primary" href={`/lab/phase-1/causal-attention/submission/${snap.submission.id}`}>Open submission</Link>
      </div>
    </Card> : null}
  </>;
}
