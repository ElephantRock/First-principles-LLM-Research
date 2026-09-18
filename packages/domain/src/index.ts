export type LearningUnitState =
  | "not_started"
  | "learning"
  | "implementing"
  | "experimenting"
  | "awaiting_mastery"
  | "mastered";

export type SubmissionState =
  | "draft"
  | "submitted"
  | "testing"
  | "needs_revision"
  | "passed";

export type TestRunState =
  | "queued"
  | "preparing"
  | "running_public"
  | "running_hidden"
  | "finalizing"
  | "passed"
  | "failed"
  | "infrastructure_error";

export type ExperimentState =
  | "draft"
  | "locked"
  | "awaiting_run"
  | "running"
  | "complete"
  | "interpreted"
  | "failed";

export type MasteryStatus = "not_ready" | "ready" | "evaluating" | "needs_evidence" | "mastered";

export interface ComputeProfile {
  detectedGpu: string | null;
  vramGiB: number | null;
  bf16Supported: boolean;
  cudaAvailable: boolean;
  selectedProfile: "8gb" | "12gb" | "16gb";
  precision: "fp16" | "bf16" | "fp32";
  gradScaler: boolean;
}

export interface SubmissionIdentity {
  id: string;
  repository: string;
  branch: string;
  commit: string;
  courseVersion: string;
  labVersion: string;
  state: SubmissionState;
}

export interface TestSummary {
  passed: number;
  total: number;
}

export interface TestRun {
  id: string;
  submissionId: string;
  state: TestRunState;
  public: TestSummary;
  hidden: TestSummary;
}

export interface ExperimentMeasurement {
  sequenceLength: 128 | 256 | 512 | 1024;
  peakReservedGiB: number;
  peakAllocatedGiB: number;
  tokensPerSecond: number;
}

export interface Experiment {
  id: string;
  type: "attention_memory_scaling";
  state: ExperimentState;
  submissionId: string;
  commit: string;
  hypothesis: string;
  prediction: string;
  conclusion?: "supports" | "partially_supports" | "does_not_support" | "inconclusive";
  measurements: readonly ExperimentMeasurement[];
}

export interface MasteryEvidence {
  conceptual: "pending" | "passed";
  implementation: "pending" | "passed";
  publicTests: "pending" | "passed";
  hiddenTests: "pending" | "passed";
  experiment: "pending" | "passed";
  interpretation: "pending" | "passed";
  overall: LearningUnitState;
}

export function canMaster(evidence: MasteryEvidence): boolean {
  return [
    evidence.conceptual,
    evidence.implementation,
    evidence.publicTests,
    evidence.hiddenTests,
    evidence.experiment,
    evidence.interpretation,
  ].every((state) => state === "passed");
}

export function nextLearningAction(state: LearningUnitState): string {
  switch (state) {
    case "not_started": return "Begin lesson";
    case "learning": return "Resume lesson";
    case "implementing": return "Resume lab";
    case "experimenting": return "Run experiment";
    case "awaiting_mastery": return "Complete interpretation";
    case "mastered": return "Continue";
  }
}
