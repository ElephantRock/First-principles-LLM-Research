# Platform Design and Build Documents

1. `../../PROJECT_DECISIONS.md` — authoritative consolidated decision register v1.1.
2. `INTERACTION_WIREFRAME_SPEC_v1.0.md` — interaction and wireframe contract for the Causal Attention vertical slice.
3. `WEB_PLATFORM_TECHNICAL_ARCHITECTURE_v1.0.md` — implementation architecture and security boundaries.
4. `CAUSAL_ATTENTION_WEB_PROTOTYPE_v0.1.md` — initial vertical-slice scaffold status.
5. `PERSISTENCE_BACKED_EVIDENCE_FLOW_v0.2.md` — durable evidence and persistence increment.
6. `REAL_SUBMISSION_EXECUTION_v0.3.md` — real submission/execution release gates and security invariants.
7. `HIDDEN_EVALUATOR_PROTOCOL_v0.3.md` — split learner-probe/private-evaluator transport contract.
8. `CAUSAL_ATTENTION_ADAPTER_v1.md` — executable runtime adapter ABI for `phase1-causal-attention@1.0`.
9. `CAUSAL_ATTENTION_MEMORY_TRACE_v2.md` — regression-tested structural evidence contract for `attention.no_permanent_kv_repeat`; supersedes the adapter document's earlier schema-1 memory-trace section where they conflict.
10. `RUNTIME_IMAGE_PROVENANCE_v0.3.md` — base-image pinning, OCI/FPLLM labels, CI provenance artifacts, and the registry-publication evidence boundary.
11. `STAGING_RELEASE_GATES_v0.3.md` — exact S1–S6 evidence required before the real-worker v0.3 release can leave draft status.

The decision register has precedence if a conflict is discovered. Runtime subcontracts may narrow implementation details but must not weaken the frozen security or evidence invariants.
