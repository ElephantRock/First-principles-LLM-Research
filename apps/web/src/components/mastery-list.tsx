import Link from "next/link";
import type { MasteryEvidence } from "@fpllm/domain";

interface MasteryListProps {
  evidence: MasteryEvidence;
  experimentDisplayId?: string | undefined;
  submissionId?: string | undefined;
  testRunId?: string | undefined;
}

export function MasteryList({
  evidence,
  experimentDisplayId = "E-014",
  submissionId,
  testRunId,
}: MasteryListProps) {
  const labels: Array<[keyof Omit<MasteryEvidence, "overall">, string, string]> = [
    ["conceptual", "Conceptual understanding", "/learn/phase-1/causal-attention#formalism"],
    ["implementation", "Required implementation", submissionId ? `/lab/phase-1/causal-attention/submission/${submissionId}` : "/lab/phase-1/causal-attention"],
    ["publicTests", "Public tests", testRunId ? `/lab/phase-1/causal-attention/tests/${testRunId}` : "/lab/phase-1/causal-attention"],
    ["hiddenTests", "Hidden correctness tests", testRunId ? `/lab/phase-1/causal-attention/tests/${testRunId}` : "/lab/phase-1/causal-attention"],
    ["experiment", "Memory experiment", `/experiments/attention-memory-scaling/${experimentDisplayId}`],
    ["interpretation", "Interpretation", `/research/journal/${experimentDisplayId}`],
  ];

  return (
    <ul className="requirement-list">
      {labels.map(([key, label, href]) => {
        const passed = evidence[key] === "passed";
        return (
          <li className="requirement-item" key={key}>
            <span className={`requirement-state ${passed ? "passed" : ""}`}>{passed ? "✓" : "○"}</span>
            <span>{label}</span>
            <Link className="small muted" href={href}>{passed ? "Evidence" : "Complete"}</Link>
          </li>
        );
      })}
    </ul>
  );
}
