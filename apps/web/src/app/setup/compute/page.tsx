import Link from "next/link";
import { getLatestEnvironmentQualificationForUser } from "@fpllm/db";
import { Badge, Card } from "@fpllm/ui";
import { redirect } from "next/navigation";
import { getCurrentLearner } from "@/lib/auth";

export const dynamic = "force-dynamic";

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function statusTone(status: string): "positive" | "warning" | "research" {
  if (status === "qualified") return "positive";
  if (status === "qualified_with_adaptations") return "research";
  return "warning";
}

export default async function ComputeSetupPage() {
  const current = await getCurrentLearner();
  if (!current) redirect("/auth/sign-in");

  const latest = await getLatestEnvironmentQualificationForUser(current.user.id);

  return <>
    <header className="page-header">
      <p className="eyebrow">Technical onboarding</p>
      <h1>Compute qualification</h1>
      <p>Detected hardware is evidence. The selected course profile is an explicit learner choice and is never silently changed.</p>
    </header>

    {!latest ? <Card className="emphasis">
      <p className="eyebrow">Environment evidence required</p>
      <h2>No environment report has been recorded yet</h2>
      <p>Submit a local environment report to <code>/api/v1/environment-reports</code>. The platform will preserve the raw evidence, derive diagnostics, and record an official 8 GB, 12 GB, or 16 GB execution profile only when you explicitly select one.</p>
    </Card> : <>
      <Card className="emphasis">
        <div className="cluster cluster--between">
          <div>
            <p className="eyebrow">Qualification state</p>
            <h2>{latest.qualification.selectedProfile ?? "Profile selection required"}</h2>
          </div>
          <Badge tone={statusTone(latest.qualification.status)}>{statusLabel(latest.qualification.status)}</Badge>
        </div>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><th>Detected GPU</th><td>{latest.qualification.detected.gpuModel ?? "Not reported"}</td></tr>
              <tr><th>Detected VRAM</th><td>{latest.qualification.detected.vramGiB == null ? "Not reported" : `${latest.qualification.detected.vramGiB.toFixed(1)} GiB`}</td></tr>
              <tr><th>CUDA</th><td>{latest.qualification.detected.cudaAvailable ? `available${latest.qualification.detected.cudaVersion ? ` (${latest.qualification.detected.cudaVersion})` : ""}` : "unavailable"}</td></tr>
              <tr><th>BF16</th><td>{latest.qualification.detected.bf16Supported ? "supported" : "unavailable"}</td></tr>
              <tr><th>Selected profile</th><td>{latest.qualification.selectedProfile ?? "Not selected"}</td></tr>
              <tr><th>Detected recommendation</th><td>{latest.qualification.recommendedProfile ?? "No official profile fits the reported evidence yet"}</td></tr>
              <tr><th>Evidence captured</th><td>{latest.environmentReport.capturedAt.toISOString()}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <p className="eyebrow">Execution overlay</p>
        <h2>Architecture unchanged; execution strategy adapts</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><th>Sequence length</th><td>{latest.qualification.execution.sequenceLength}</td></tr>
              <tr><th>Microbatch</th><td>{latest.qualification.execution.microBatchSize ?? "Select a profile"}</td></tr>
              <tr><th>Gradient accumulation</th><td>{latest.qualification.execution.gradientAccumulationSteps ?? "Select a profile"}</td></tr>
              <tr><th>Tokens/update</th><td>{latest.qualification.execution.tokensPerUpdate.toLocaleString()}</td></tr>
              <tr><th>Activation checkpointing</th><td>{latest.qualification.execution.activationCheckpointing == null ? "Select a profile" : latest.qualification.execution.activationCheckpointing ? "on" : "off initially"}</td></tr>
              <tr><th>Precision</th><td>{latest.qualification.execution.precision}{latest.qualification.execution.gradScaler ? " + GradScaler" : ""}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <p className="eyebrow">Diagnostics</p>
        <h2>What the evidence implies</h2>
        {latest.qualification.diagnostics.length === 0
          ? <p>No adaptations or follow-up actions were identified from this report.</p>
          : <ul>
              {latest.qualification.diagnostics.map((item) => <li key={item.code}>
                <strong>{item.code.replaceAll("_", " ")}</strong>: {item.summary}
              </li>)}
            </ul>}
      </Card>
    </>}

    <p><Link className="button primary" href="/home">Continue to dashboard</Link></p>
  </>;
}
