import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getLearnerSnapshot, shortSha } from "@/lib/persistence";
import "katex/dist/katex.min.css";
import "./globals.css";
export const metadata:Metadata={title:"First Principles LLM Research",description:"Build, measure, and research language models from first principles."};
export const dynamic="force-dynamic";
export default async function RootLayout({children}:{children:ReactNode}){const snap=await getLearnerSnapshot();const count=[snap.mastery.conceptual,snap.mastery.implementation,snap.mastery.publicTests,snap.mastery.hiddenTests,snap.mastery.experiment,snap.mastery.interpretation].filter(v=>v==="passed").length;return <html lang="en"><body><AppShell operational={{vramGiB:snap.compute?.vramGiB??null,precision:snap.compute?.precision??null,profile:snap.compute?.selectedProfile??null,commit:shortSha(snap.submission?.commitSha),experiment:snap.experiment?.displayId??null,masteryCount:count}}>{children}</AppShell></body></html>}
