import Link from "next/link";
import { Badge, Card } from "@fpllm/ui";
import { CourseMdx } from "@/components/course-mdx";
import { SectionRail } from "@/components/section-rail";
import { getCausalAttentionContent } from "@/lib/course-content";

export default async function CausalAttentionUnitPage() {
  const content = await getCausalAttentionContent();
  const sections = content.unit.sections.map((s) => [s.id, s.title] as const);
  return <><header className="page-header"><p className="eyebrow">Phase 1 · Build</p><h1>{content.unit.title}</h1><p>{content.unit.objective}</p><div className="page-actions"><Badge tone="research">Learning unit v{content.unit.version}</Badge><Badge tone="positive">Git content {content.contentHash.slice(0,12)}…</Badge></div></header>
    <div className="unit-layout"><SectionRail items={sections}/><div className="prose"><CourseMdx source={content.lessonMdx}/><Card className="emphasis"><p className="eyebrow">Implementation bridge</p><p>The lab contract and experiment definition are loaded from the same versioned course bundle.</p><Link className="button primary" href="/lab/phase-1/causal-attention">Open Lab</Link></Card></div></div></>;
}
