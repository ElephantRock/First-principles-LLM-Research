import { createHash } from "node:crypto";
import { prisma } from "./client";

export const CAUSAL_ATTENTION_UNIT_ID = "phase1-causal-attention";
export const CAUSAL_ATTENTION_UNIT_VERSION = "1.0";
export const REQUIRED_MASTERY_DIMENSIONS = [
  "conceptual",
  "implementation",
  "publicTests",
  "hiddenTests",
  "experiment",
  "interpretation",
] as const;

export type MasteryDimension = typeof REQUIRED_MASTERY_DIMENSIONS[number];

export function canonicalJsonSha256(value: unknown): string {
  const stable = JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  return createHash("sha256").update(stable).digest("hex");
}

export async function getDemoUser() {
  const user = await prisma.user.findUnique({ where: { handle: "demo" } });
  if (!user) throw new Error("Demo user is not seeded. Run pnpm db:seed.");
  return user;
}

export async function getCausalAttentionMastery(userId: string) {
  const evidence = await prisma.masteryEvidence.findMany({
    where: {
      userId,
      unitId: CAUSAL_ATTENTION_UNIT_ID,
      unitVersion: CAUSAL_ATTENTION_UNIT_VERSION,
      status: "passed",
    },
    orderBy: { createdAt: "asc" },
  });
  const passed = new Set(evidence.map((item) => item.dimension));
  const dimensions = Object.fromEntries(
    REQUIRED_MASTERY_DIMENSIONS.map((dimension) => [dimension, passed.has(dimension) ? "passed" : "pending"]),
  ) as Record<MasteryDimension, "passed" | "pending">;
  return {
    ...dimensions,
    overall: REQUIRED_MASTERY_DIMENSIONS.every((dimension) => passed.has(dimension)) ? "mastered" : "awaiting_mastery",
    evidence,
  };
}

export async function addMasteryEvidence(input: {
  userId: string;
  dimension: MasteryDimension;
  evidenceType: string;
  evidenceRef: string;
}) {
  return prisma.masteryEvidence.upsert({
    where: {
      userId_unitId_unitVersion_dimension_evidenceRef: {
        userId: input.userId,
        unitId: CAUSAL_ATTENTION_UNIT_ID,
        unitVersion: CAUSAL_ATTENTION_UNIT_VERSION,
        dimension: input.dimension,
        evidenceRef: input.evidenceRef,
      },
    },
    update: { status: "passed" },
    create: {
      userId: input.userId,
      unitId: CAUSAL_ATTENTION_UNIT_ID,
      unitVersion: CAUSAL_ATTENTION_UNIT_VERSION,
      dimension: input.dimension,
      evidenceType: input.evidenceType,
      evidenceRef: input.evidenceRef,
      status: "passed",
    },
  });
}
