import { getLearnerSnapshot as getLearnerSnapshotForUser } from "@fpllm/db";
import { redirect } from "next/navigation";
import { getCurrentLearner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function getOptionalLearnerSnapshot() {
  const current = await getCurrentLearner();
  if (!current) return null;
  return getLearnerSnapshotForUser(current.user.id);
}

export async function getLearnerSnapshot() {
  const current = await getCurrentLearner();
  if (!current) redirect("/auth/sign-in");
  return getLearnerSnapshotForUser(current.user.id);
}

export function shortSha(sha: string | null | undefined) {
  return sha ? sha.slice(0, 7) : "—";
}
