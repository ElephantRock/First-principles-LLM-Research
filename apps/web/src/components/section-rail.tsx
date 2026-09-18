export function SectionRail({ items }: { items: readonly (readonly [string, string])[] }) {
  return <nav className="section-rail" aria-label="Unit sections"><ol>
    {items.map(([id, label], index) => <li key={id}><a href={`#${id}`}><span className="section-index">{String(index + 1).padStart(2, "0")}</span>{label}</a></li>)}
  </ol></nav>;
}
