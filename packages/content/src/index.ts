import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const sectionSchema = z.object({ id: z.string().min(1), title: z.string().min(1) });

export const courseSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  delivery: z.literal("self-paced"),
  mastery_model: z.literal("evidence-based"),
});

export const unitSchema = z.object({
  id: z.string().min(1),
  phase: z.number().int().nonnegative(),
  slug: z.string().min(1),
  title: z.string().min(1),
  version: z.string().min(1),
  objective: z.string().min(1),
  estimatedActiveMinutes: z.number().int().positive(),
  prerequisites: z.array(z.string()),
  sections: z.array(sectionSchema).min(1),
});

export const labSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  requirements: z.array(z.string().min(1)).min(1),
  prohibited: z.array(z.string().min(1)),
  publicTestCommand: z.string().min(1),
  submissionIdentity: z.literal("immutable-git-commit"),
});

export const experimentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  question: z.string().min(1),
  sequenceLengths: z.array(z.union([z.literal(128), z.literal(256), z.literal(512), z.literal(1024)])).min(1),
  controlledVariables: z.array(z.string().min(1)),
  requiredMetrics: z.array(z.string().min(1)),
  predictionMustBeLocked: z.boolean(),
});

export const masterySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  requirements: z.record(z.string(), z.object({ evidence: z.string().min(1) })),
  completionRule: z.literal("all-required-evidence-passed"),
});

export const readingsSchema = z.object({
  readings: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    purpose: z.string().min(1),
    requiredSections: z.array(z.string()),
  })),
});

export const contentManifestSchema = z.object({
  schemaVersion: z.literal("1"),
  courseId: z.string(),
  courseVersion: z.string(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  files: z.array(z.object({
    path: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().nonnegative(),
  })),
});

export type CourseDefinition = z.infer<typeof courseSchema>;
export type UnitDefinition = z.infer<typeof unitSchema>;
export type LabDefinition = z.infer<typeof labSchema>;
export type ExperimentDefinition = z.infer<typeof experimentSchema>;
export type MasteryDefinition = z.infer<typeof masterySchema>;
export type ReadingsDefinition = z.infer<typeof readingsSchema>;

export interface LearningUnitBundle {
  course: CourseDefinition;
  unit: UnitDefinition;
  lab: LabDefinition;
  experiment: ExperimentDefinition;
  mastery: MasteryDefinition;
  readings: ReadingsDefinition;
  lessonMdx: string;
  contentHash: string;
}

async function readYaml<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await readFile(path, "utf8");
  return schema.parse(parseYaml(raw));
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function loadCausalAttentionBundle(courseRoot: string): Promise<LearningUnitBundle> {
  const root = resolve(courseRoot);
  const unitRoot = join(root, "phase1", "causal-attention");
  const [course, unit, lab, experiment, mastery, readings, lessonMdx] = await Promise.all([
    readYaml(join(root, "course.yaml"), courseSchema),
    readYaml(join(unitRoot, "unit.yaml"), unitSchema),
    readYaml(join(unitRoot, "lab.yaml"), labSchema),
    readYaml(join(unitRoot, "experiment.yaml"), experimentSchema),
    readYaml(join(unitRoot, "mastery.yaml"), masterySchema),
    readYaml(join(unitRoot, "readings.yaml"), readingsSchema),
    readFile(join(unitRoot, "lesson.mdx"), "utf8"),
  ]);

  if (unit.id !== "phase1-causal-attention") throw new Error("Unexpected Causal Attention unit ID");
  if (lab.id !== "phase1-causal-attention-lab") throw new Error("Unexpected Causal Attention lab ID");
  if (experiment.id !== "attention-memory-scaling") throw new Error("Unexpected experiment ID");

  const knownEvidence = new Set([
    "concept-check-and-explanation",
    "immutable-submission",
    "test-run",
    "invariant-oriented-hidden-test-run",
    "attention-memory-scaling",
    "versioned-journal-entry",
  ]);
  for (const [key, requirement] of Object.entries(mastery.requirements)) {
    if (!knownEvidence.has(requirement.evidence)) {
      throw new Error(`Mastery requirement ${key} references unknown evidence ${requirement.evidence}`);
    }
  }

  const contentHash = sha256(JSON.stringify({ course, unit, lab, experiment, mastery, readings, lessonMdx }));
  return { course, unit, lab, experiment, mastery, readings, lessonMdx, contentHash };
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await walkFiles(full));
    else if (entry.isFile() && entry.name !== "content-manifest.json") out.push(full);
  }
  return out.sort();
}

export async function validateContentManifest(courseRoot: string): Promise<void> {
  const root = resolve(courseRoot);
  const manifest = contentManifestSchema.parse(JSON.parse(await readFile(join(root, "content-manifest.json"), "utf8")));
  const paths = await walkFiles(root);
  const observed = await Promise.all(paths.map(async (path) => {
    const body = await readFile(path);
    return { path: relative(resolve(root, ".."), path).replaceAll("\\", "/"), sha256: sha256(body), bytes: body.byteLength };
  }));
  const observedByPath = new Map(observed.map((file) => [file.path, file]));
  for (const expected of manifest.files) {
    const actual = observedByPath.get(expected.path);
    if (!actual) throw new Error(`Content manifest file missing: ${expected.path}`);
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      throw new Error(`Content manifest mismatch: ${expected.path}`);
    }
  }
  await loadCausalAttentionBundle(root);
}
