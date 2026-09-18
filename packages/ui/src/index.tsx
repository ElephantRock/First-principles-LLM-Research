import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "positive" | "warning" | "negative" | "research" }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Card({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`card ${className}`.trim()} {...props}>{children}</section>;
}

export function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button button--primary ${className}`.trim()} {...props}>{children}</button>;
}

export function SectionTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return <header className="section-title">
    {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
    <h1>{title}</h1>
    {children}
  </header>;
}
