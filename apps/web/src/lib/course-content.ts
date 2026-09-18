import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadCausalAttentionBundle } from "@fpllm/content";

function findCourseRoot(): string {
  const configured = process.env.COURSE_CONTENT_ROOT;
  const candidates = [
    configured ? resolve(configured) : null,
    resolve(process.cwd(), "course"),
    resolve(process.cwd(), "../../course"),
  ].filter((value): value is string => Boolean(value));
  const root = candidates.find((candidate) => existsSync(resolve(candidate, "course.yaml")));
  if (!root) throw new Error(`Unable to resolve course content root. Tried: ${candidates.join(", ")}`);
  return root;
}

export async function getCausalAttentionContent() {
  return loadCausalAttentionBundle(findCourseRoot());
}
