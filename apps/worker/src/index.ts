import { logEvent } from "@fpllm/observability";

logEvent("worker.scaffold.ready", {}, {
  executionEnabled: false,
  reason: "v0.1 defines the isolation boundary but does not execute learner code",
});
