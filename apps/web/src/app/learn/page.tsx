import Link from "next/link";
import { Badge } from "@fpllm/ui";

const nodes = [
  ["Text & Bytes", "mastered"],
  ["BPE Tokenizer", "mastered"],
  ["LM Objective", "mastered"],
  ["Causal Attention", "current"],
  ["RoPE", "available"],
  ["GQA", "available"],
  ["Decoder", "disabled"],
  ["Trainer", "disabled"],
] as const;

export default function LearnMapPage() {
  return <>
    <header className="page-header"><p className="eyebrow">Learn</p><h1>Phase 1 dependency map</h1><p>Read ahead freely; downstream mastery remains dependent on prerequisite evidence.</p></header>
    <div className="node-map"><div className="node-column">
      {nodes.map(([label, state], index) => <div key={label}>
        <div className={`course-node ${state === "current" ? "current" : ""} ${state === "disabled" ? "disabled" : ""}`}>
          <div className="split"><strong>{label}</strong><Badge tone={state === "mastered" ? "positive" : state === "current" ? "research" : state === "disabled" ? "neutral" : "warning"}>{state}</Badge></div>
          {label === "Causal Attention" ? <p className="small muted">5/6 mastery dimensions complete. <Link href="/learn/phase-1/causal-attention">Open unit →</Link></p> : null}
        </div>
        {index < nodes.length - 1 ? <div className="node-arrow" aria-hidden="true">↓</div> : null}
      </div>)}
    </div></div>
  </>;
}
