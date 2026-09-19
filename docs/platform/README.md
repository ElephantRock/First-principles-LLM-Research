# Platform Design and Build Documents

1. `../../PROJECT_DECISIONS.md` — consolidated decision register v1.1 baseline.
2. `../../PROJECT_DECISIONS_v1.2.md` — authoritative v1.2 delta; §8 contains the post-Codex evidence qualification and supersedes broader v0.4 verification wording where they conflict.
3. `INTERACTION_WIREFRAME_SPEC_v1.0.md` — interaction and wireframe contract for the Causal Attention vertical slice.
4. `WEB_PLATFORM_TECHNICAL_ARCHITECTURE_v1.0.md` — implementation architecture and security boundaries.
5. `CAUSAL_ATTENTION_WEB_PROTOTYPE_v0.1.md` — initial vertical-slice scaffold status.
6. `PERSISTENCE_BACKED_EVIDENCE_FLOW_v0.2.md` — durable evidence and persistence increment.
7. `REAL_SUBMISSION_EXECUTION_v0.3.md` — real submission/execution release gates and security invariants.
8. `HIDDEN_EVALUATOR_PROTOCOL_v0.3.md` — split learner-probe/private-evaluator transport contract.
9. `CAUSAL_ATTENTION_ADAPTER_v1.md` — executable runtime adapter ABI for `phase1-causal-attention@1.0`.
10. `CAUSAL_ATTENTION_MEMORY_TRACE_v2.md` — regression-tested structural evidence contract for `attention.no_permanent_kv_repeat`; supersedes the adapter document's earlier schema-1 memory-trace section where they conflict.
11. `RUNTIME_IMAGE_PROVENANCE_v0.3.md` — base-image pinning, OCI/FPLLM labels, CI provenance artifacts, and the registry-publication evidence boundary.
12. `STAGING_RELEASE_GATES_v0.3.md` — exact S1–S6 evidence required before the real-worker v0.3 release can leave draft status.
13. `STAGING_SUBMISSION_E2E_v0.3.md` — guarded GitHub Actions harness for the real GitHub App -> durable job -> worker -> Docker -> persisted-evidence release gate.
14. `REAL_LEARNER_IDENTITY_v0.4.md` — merged v0.4 identity/onboarding baseline with post-release qualification of what the frozen release evidence did and did not verify.
15. `PLATFORM_PRODUCTION_BETA_v0.5.md` — production-beta contract, P0–P7 release gates, operations/security requirements, and external learner validation protocol.

Decision precedence is: v1.2 delta over v1.1 where they conflict; otherwise v1.1 remains in force. Within v1.2, the post-review qualification in §8 governs evidence claims. Runtime subcontracts may narrow implementation details but must not weaken frozen security or evidence invariants.
