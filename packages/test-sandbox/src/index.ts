export interface SandboxJob {
  id: string;
  repository: string;
  commit: string;
  hiddenTestBundleId: string;
  timeoutSeconds: number;
  cpuLimit: number;
  memoryMiB: number;
  networkEnabled: false;
}

export interface SandboxResult {
  jobId: string;
  exitCode: number;
  status: "passed" | "failed" | "infrastructure_error";
  publicSummary: { passed: number; total: number };
  hiddenSummary: { passed: number; total: number };
  invariantFailures: readonly string[];
}
