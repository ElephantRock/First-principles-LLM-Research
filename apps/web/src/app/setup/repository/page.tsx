import Link from "next/link";
import { Badge, Card } from "@fpllm/ui";
import { getLearnerSnapshot, shortSha } from "@/lib/persistence";
export const dynamic="force-dynamic";
export default async function RepositorySetupPage(){const snap=await getLearnerSnapshot();return <><header className="page-header"><p className="eyebrow">Technical onboarding</p><h1>Course repository</h1><p>Repository and commit identities are durable evidence references.</p></header><Card><div className="split"><div><p className="eyebrow">Repository</p><h2>{snap.repository?`${snap.repository.owner}/${snap.repository.name}`:"Not bound"}</h2><p className="small muted">Latest submission commit <span className="mono">{shortSha(snap.submission?.commitSha)}</span></p></div><Badge tone={snap.repository?"positive":"warning"}>{snap.repository?"Connected":"Required"}</Badge></div></Card><div className="page-actions"><Link className="button primary" href="/home">Continue to dashboard</Link></div></>}
