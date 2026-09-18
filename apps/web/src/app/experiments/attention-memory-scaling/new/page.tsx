import { Badge } from "@fpllm/ui";
import { ExperimentLockForm } from "@/components/experiment-lock-form";
import { getCausalAttentionContent } from "@/lib/course-content";
import { getLearnerSnapshot, shortSha } from "@/lib/persistence";

export const dynamic = "force-dynamic";
export default async function NewExperimentPage() {
  const [content, snap] = await Promise.all([getCausalAttentionContent(), getLearnerSnapshot()]);
  if (!snap.experiment || !snap.submission) return <p>Seed/create the experiment after a passed submission.</p>;
  return <><header className="page-header"><p className="eyebrow">Experiment {snap.experiment.displayId}</p><h1>{content.experiment.title}</h1><p>{content.experiment.question} Lock the prediction before importing measurements.</p><div className="page-actions"><Badge tone="research">{snap.experiment.state}</Badge><Badge>commit {shortSha(snap.experiment.commitSha)}</Badge></div></header><div className="grid-2"><section><div className="card"><p className="eyebrow">Question</p><p>{content.experiment.question}</p></div><ExperimentLockForm experimentId={snap.experiment.id} displayId={snap.experiment.displayId} commit={snap.experiment.commitSha} initialHypothesis={snap.experiment.hypothesis} initialPrediction={snap.experiment.prediction} locked={Boolean(snap.experiment.lockedAt)} /></section><aside className="stack"><div className="card"><p className="eyebrow">Independent variable</p><p>Sequence length S</p><p className="mono small">{content.experiment.sequenceLengths.join(" · ")}</p></div><div className="card"><p className="eyebrow">Controlled variables</p><p className="small muted">{content.experiment.controlledVariables.join(" · ")}</p></div></aside></div></>;
}
