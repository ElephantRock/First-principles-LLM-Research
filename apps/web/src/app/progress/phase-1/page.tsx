import Link from "next/link";
import { Badge, Card } from "@fpllm/ui";
import { MasteryList } from "@/components/mastery-list";
import { getLearnerSnapshot } from "@/lib/persistence";
import type { MasteryEvidence } from "@fpllm/domain";
export const dynamic = "force-dynamic";
export default async function ProgressPage() {
  const snap=await getLearnerSnapshot();
  const evidence: MasteryEvidence={conceptual:snap.mastery.conceptual,implementation:snap.mastery.implementation,publicTests:snap.mastery.publicTests,hiddenTests:snap.mastery.hiddenTests,experiment:snap.mastery.experiment,interpretation:snap.mastery.interpretation,overall:snap.mastery.overall};
  const count=[evidence.conceptual,evidence.implementation,evidence.publicTests,evidence.hiddenTests,evidence.experiment,evidence.interpretation].filter(v=>v==="passed").length;
  return <><header className="page-header"><p className="eyebrow">Progress</p><h1>Phase 1 mastery</h1><p>Mastery is computed server-side from linked evidence rather than manually toggled completion state.</p></header><div className="grid-2"><Card><p className="eyebrow">Attention mastery detail</p><MasteryList evidence={evidence} experimentDisplayId={snap.experiment?.displayId ?? "E-014"} submissionId={snap.submission?.id} testRunId={snap.submission?.testRuns[0]?.id}/></Card><Card><p className="eyebrow">Current gate</p><h2>{count} / 6 complete</h2><Badge tone={evidence.overall==="mastered"?"positive":"warning"}>{evidence.overall.replaceAll("_"," ")}</Badge>{evidence.interpretation!=="passed" && snap.experiment ? <div className="page-actions"><Link className="button primary" href={`/experiments/attention-memory-scaling/${snap.experiment.displayId}`}>Complete interpretation</Link></div>:null}</Card></div></>;
}
