import { getDemoSnapshot } from "@fpllm/db";

export const dynamic = "force-dynamic";
export async function getLearnerSnapshot() { return getDemoSnapshot(); }
export function shortSha(sha: string | null | undefined) { return sha ? sha.slice(0, 7) : "—"; }
