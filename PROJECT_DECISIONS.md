# First Principles LLM Research
## Consolidated Decision Register & Project Specification

**Document version:** 1.1  
**Date:** 2026-09-18  
**Purpose:** Consolidate all course, curriculum, compute, Phase 1 implementation, research-methodology, learning-platform, and UX decisions made to date into one authoritative project document.

---

# 0. Decision status convention

This document uses three statuses:

- **FROZEN** — treat as an active project constraint unless deliberately revised in a later version.
- **PROVISIONAL** — adopted for implementation or testing, but expected to be validated empirically before final release.
- **OPEN** — intentionally not decided yet.

Where a later decision superseded an earlier one, only the current decision is treated as authoritative.

---

# 1. Course identity

## 1.1 Name — FROZEN

**First Principles LLM Research**

## 1.2 Subtitle — FROZEN

**Build, Optimize, Scale, Post-Train, and Study Verifiable Agents**

## 1.3 Delivery model — FROZEN

Self-paced online course.

## 1.4 Orientation — FROZEN

The course is not primarily a “how to use LLM APIs” course. Its purpose is to develop the ability to investigate modern language models scientifically by moving through:

**implementation → measurement → controlled experiment → falsifiable hypothesis → scientific result**

## 1.5 Course mission — FROZEN

Develop the learner’s ability to:

1. reconstruct a modern language model from first principles;
2. train and debug it;
3. measure its computational behavior;
4. optimize systems bottlenecks;
5. construct and version data pipelines;
6. run controlled scaling experiments;
7. post-train models with supervised, preference, and reinforcement-learning methods;
8. build verifiable interactive environments;
9. study long-horizon model behavior;
10. formulate and test a novel research claim reproducibly.

## 1.6 Final scientific objective — FROZEN

The learner should be able to execute:

\[
\text{Hypothesis}
\rightarrow
\text{Experiment}
\rightarrow
\text{Evidence}
\rightarrow
\text{Conclusion}
\]

in a reproducible way.

---

# 2. Intended learner

## 2.1 Target learner — FROZEN

Technically capable:

- software developer;
- ML engineer;
- graduate student;
- independent researcher;
- technically strong learner seeking to become capable of independent LLM research.

## 2.2 Assumed prerequisites — FROZEN

Learners should already be comfortable with:

- Python;
- basic PyTorch;
- vectors and matrices;
- derivatives and gradient descent;
- basic probability;
- Linux command line;
- Git.

## 2.3 Not assumed — FROZEN

The course teaches rather than assumes:

- CUDA systems programming;
- Triton;
- distributed training;
- scaling laws;
- preference optimization;
- RL/RLVR;
- agent-environment design;
- research methodology.

---

# 3. Course effort and completion model

## 3.1 Estimated effort — FROZEN

Core curriculum:

**approximately 180–240 active hours**

Optional research extensions are effectively unbounded.

## 3.2 Completion philosophy — FROZEN

Completion is based on demonstrated capability, not video or reading completion.

The governing learning loop is:

\[
\boxed{
\text{Learn}
\rightarrow
\text{Implement}
\rightarrow
\text{Measure}
\rightarrow
\text{Explain}
}
\]

## 3.3 Graduation requirement — FROZEN

Graduation requires:

### Working System
A functioning implementation/environment.

### Reproducible Evidence
Controlled experiments with:

- configurations;
- seeds;
- baselines;
- metrics;
- artifacts;
- ablations where relevant.

### Scientific Argument
A report that distinguishes:

\[
\text{Observation}
\neq
\text{Interpretation}
\neq
\text{Claim}
\]

and states what the evidence does and does not support.

Video completion is not a graduation criterion.

---

# 4. Achievement tracks

Three completion tracks are frozen.

## 4.1 Builder — FROZEN

Focus:

- complete implementation stack;
- core correctness;
- required mastery gates.

## 4.2 Research Engineer — FROZEN

Builder requirements plus:

- rigorous profiling;
- reproducibility;
- ablations;
- stronger evaluation;
- systems analysis.

## 4.3 Researcher — FROZEN

Research Engineer requirements plus:

- novel hypothesis;
- original experimental program;
- publication-style capstone.

Learners may change tracks later; the selection should not permanently lock them.

---

# 5. Course architecture

The course is organized as Phase 0 plus six technical/research phases.

| Phase | Name | Governing question | Indicative effort | Principal output |
|---|---|---|---:|---|
| 0 | Research Setup | Can the experiment be reproduced? | 5–10 h | reproducible environment |
| 1 | Build | How does an LLM actually work? | ~43–46 h current estimate | ~100M decoder stack |
| 2 | Optimize | Where does computation actually go? | 30–40 h | profiled/optimized stack |
| 3 | Scale | What determines performance before training? | 30–40 h | corpus + scaling study |
| 4 | Post-Train | How can behavior be deliberately changed? | 35–45 h | SFT/preference/RLVR comparison |
| 5 | Agent | What changes when the model acts in an environment? | 25–35 h | verifiable environment + agent study |
| 6 | Science | What new claim does the evidence support? | 30–40 h | paper + reproduction package |

---

# 6. Cross-course scientific principles

## 6.1 Research starts before the capstone — FROZEN

The learner begins maintaining a research journal in Phase 0.

A research question is selected during Phase 3, not after all technical phases are complete.

## 6.2 Research Selection Gate — FROZEN

During Phase 3 the learner formalizes:

- Question
- Hypothesis
- Independent variable
- Dependent variable
- Controls
- Baselines
- Expected evidence
- Falsification condition
- Compute estimate

The hypothesis evolves through Phases 4–6.

## 6.3 Model scale is not scientific quality — FROZEN

A controlled 100M–1B experiment with a strong verifier/environment can be scientifically more useful than a poorly controlled larger-model reproduction.

Guiding principle:

\[
\boxed{
\text{experimental quality} > \text{model size}
}
\]

## 6.4 Reasoning traces — FROZEN

`<thought>` tags or visible reasoning text are **not** treated as evidence that a model is reasoning.

Reasoning-like traces are observable behavior, not proof of an internal reasoning mechanism.

Evaluation should emphasize:

- verified task success;
- pass@k where relevant;
- held-out generalization;
- reward hacking;
- response length;
- inference cost.

## 6.5 Offline preference learning vs online RL — FROZEN

The course explicitly distinguishes:

### Offline preference optimization
Uses fixed preference pairs:

\[
(x,y^+,y^-)
\]

### Online RL
Uses trajectories sampled from the current policy:

\[
\tau \sim \pi_\theta
\]

with reward:

\[
r(\tau)
\]

These are not collapsed into one conceptual category.

## 6.6 Long-horizon definition — FROZEN

Long horizon is defined by consequential environment transitions/actions, not token count.

\[
H =
\text{number of consequential environment transitions}
\]

Primary analysis:

\[
P(\text{success}\mid H)
\]

A useful conceptual model:

\[
P(\text{success}) \approx (1-\epsilon)^H
\]

## 6.7 Environment vs benchmark — FROZEN

A Phase 5 environment is explicitly modeled as:

\[
E=(S,A,T,R,O)
\]

with controlled task distributions and difficulty parameters.

A benchmark is not treated as synonymous with the environment itself.

---

# 7. Phase 0 — Research Setup

Phase 0 covers:

- project organization;
- environment management;
- PyTorch/CUDA validation;
- configuration;
- seeds;
- logging;
- checkpointing;
- experiment directories;
- Git;
- metrics;
- GPU profiling fundamentals;
- reproducibility.

The conceptual reproducibility model is:

\[
R=f(\text{code},\text{config},\text{data},\text{seed},\text{environment})
\]

## Phase 0 gate — FROZEN

Run the same small experiment twice from a clean environment and reproduce the result within the specified numerical tolerance.

---

# 8. Compute-accessibility policy

This section supersedes the original 16–24 GB baseline.

## 8.1 Official single-GPU profiles — FROZEN

\[
\boxed{
8\text{ GB Minimum}
\quad|\quad
12\text{ GB Standard}
\quad|\quad
16\text{ GB Reference}
}
\]

| Profile | VRAM | Role |
|---|---:|---|
| Minimum | 8 GB | mandatory accessibility floor |
| Standard | 12 GB | primary development/learner target |
| Reference | 16 GB | reference results and greater throughput |

## 8.2 Core rule — FROZEN

All core assignments use:

\[
\boxed{
\text{same concepts}
+
\text{same source code}
+
\text{same tests}
+
\text{different execution configuration}
}
\]

Hardware adaptation happens through:

- microbatch size;
- gradient accumulation;
- activation checkpointing;
- precision;
- sequence length only where necessary;
- other execution controls.

It does **not** produce an intellectually reduced 8 GB curriculum.

## 8.3 8 GB release rule — FROZEN

**8 GB is a release blocker for mandatory single-GPU exercises.**

If a mandatory exercise cannot be executed in a reasonable 8 GB configuration, it must be:

1. optimized;
2. reduced in experimental scale without changing its learning objective; or
3. moved to an optional/hosted extension.

## 8.4 Development center — FROZEN

12 GB is the nominal course development profile.

Reason:

- 16 GB is too easy to overfit development assumptions to;
- 8 GB is unnecessarily restrictive for primary development;
- 12 GB forces meaningful memory discipline while remaining practical.

## 8.5 Local ownership — FROZEN

Local NVIDIA GPU ownership is **not** a course prerequisite.

Selected CUDA-specific labs may use hosted compute.

## 8.6 Phase 2 CUDA requirement — FROZEN

Triton/kernel-programming laboratories may explicitly require access to an NVIDIA CUDA GPU.

The policy is:

> Temporary access to a CUDA-capable NVIDIA GPU is required for selected systems labs. Local ownership is not required.

## 8.7 Multi-GPU work — FROZEN

DDP/FSDP/TP work is not a local-hardware prerequisite.

Multi-GPU concepts use:

- conceptual path;
- bounded hosted/cloud lab;
- optional research extension.

---

# 9. Phase 1 — Build

## 9.1 Governing question — FROZEN

**How does an LLM actually work?**

## 9.2 Phase 1 module sequence — FROZEN

1. Memory and experiment preflight
2. Text, Unicode, UTF-8, bytes
3. BPE tokenizer
4. Autoregressive language-model objective
5. Attention from raw tensors
6. RoPE
7. RMSNorm
8. SwiGLU
9. Grouped-query attention
10. Full decoder assembly
11. Optimization/training
12. Mixed precision and gradient accumulation
13. Checkpoint/restart
14. KV cache and generation
15. Evaluation/debugging
16. Phase qualification

## 9.3 Phase 1 effort — CURRENT ESTIMATE

Approximately **43–46 active hours**, replacing the earlier 30–40 hour estimate.

Wall-clock training time is not counted as learner effort.

---

# 10. Canonical Phase 1 model

## 10.1 Architecture — FROZEN

| Field | Value |
|---|---:|
| `vocab_size` | 32,000 |
| `max_seq_len` | 512 |
| `n_layers` | 12 |
| `d_model` | 768 |
| `n_heads` | 12 |
| `n_kv_heads` | 4 |
| `head_dim` | 64 |
| `d_ff` | 2,048 |
| normalization | RMSNorm |
| normalization placement | pre-norm |
| MLP | SwiGLU |
| positional method | RoPE |
| attention | causal GQA |
| attention dropout | 0 |
| residual dropout | 0 |
| linear bias | false |
| embedding/LM-head tying | true |
| RMSNorm epsilon | \(10^{-5}\) |
| RoPE base | 10,000 |
| initialization std. dev. | 0.02 |

Exact trainable parameter count:

\[
\boxed{100{,}092{,}672}
\]

The student must both derive and programmatically verify the parameter count.

## 10.2 Model architecture principle — FROZEN

The ~100M model is a **configuration**, not a bespoke hard-coded program.

The same implementation must support small test configurations.

---

# 11. Phase 1 mathematical/implementation contract

## 11.1 RMSNorm — FROZEN

\[
\operatorname{RMSNorm}(x)
=
w\odot
\frac{x}
{\sqrt{\frac{1}{d}\sum_i x_i^2+\epsilon}}
\]

- no bias;
- scale initialized to one;
- reduction performed in FP32.

## 11.2 RoPE — FROZEN

Applied to **Q and K only**.

Adjacent dimensions form rotation pairs.

The implementation must support arbitrary starting positions so the same primitive works with KV-cache decoding.

## 11.3 Grouped-query attention — FROZEN

Canonical values:

\[
H_q=12,\quad H_{kv}=4,\quad G=3,\quad d_h=64
\]

Shapes:

\[
Q:[B,12,S,64]
\]

\[
K,V:[B,4,S,64]
\]

Preferred transparent representation:

\[
Q:[B,4,3,S,64]
\]

with K/V broadcast conceptually from:

\[
[B,4,1,S,64]
\]

No permanent repeated K/V representation is required.

## 11.4 Causal attention — FROZEN

\[
A=
\frac{QK^\top}{\sqrt{64}}
\]

with future entries masked to \(-\infty\).

Softmax is computed in FP32.

## 11.5 SwiGLU — FROZEN

\[
\operatorname{SwiGLU}(x)
=
W_d[
\operatorname{SiLU}(xW_g)
\odot
(xW_u)
]
\]

with:

\[
d=768,\qquad d_{ff}=2048
\]

and no biases.

## 11.6 Decoder block — FROZEN

Strict pre-normalization:

\[
a_l
=
h_l
+
\operatorname{Attention}(\operatorname{RMSNorm}(h_l))
\]

\[
h_{l+1}
=
a_l
+
\operatorname{SwiGLU}(\operatorname{RMSNorm}(a_l))
\]

## 11.7 Weight tying — FROZEN

The LM output projection is the token-embedding parameter itself.

It is true parameter sharing, not two equal but distinct matrices.

---

# 12. Phase 1 allowed abstraction boundary

## Allowed — FROZEN

- PyTorch autograd
- `nn.Module`
- `nn.Parameter`
- `nn.Linear`
- `nn.Embedding`
- tensor operations
- matrix multiplication
- indexing
- standard mathematical functions
- `torch.optim.AdamW`

## Disallowed for the first-principles implementation — FROZEN

- `nn.MultiheadAttention`
- `nn.Transformer*`
- `scaled_dot_product_attention`
- FlashAttention
- xFormers attention
- prebuilt Hugging Face Transformer blocks
- Hugging Face tokenizer training
- prebuilt BPE trainer for the core assignment

Production implementations become valid comparison targets in Phase 2.

---

# 13. Phase 1 memory model

Learners explicitly model:

\[
M_{\text{peak}}
=
M_{\text{persistent}}
+
M_{\text{activations}}
+
M_{\text{attention}}
+
M_{\text{logits}}
+
M_{\text{temporary}}
+
M_{\text{runtime}}
\]

For approximately 100M parameters using FP32 parameter/gradient/Adam state, persistent state is roughly 1.49 GiB before activations and temporary buffers.

The lesson emphasizes:

\[
M_{\text{attention}}\propto BHLS^2
\]

and contrasts batch-size growth with sequence-length growth.

The pedagogy is:

\[
\boxed{
\text{derive}
\rightarrow
\text{predict}
\rightarrow
\text{measure}
\rightarrow
\text{certify}
}
\]

---

# 14. Candidate Phase 1 hardware overlays

These are **PROVISIONAL** until certified on real GPUs.

| Setting | 8 GB | 12 GB | 16 GB |
|---|---:|---:|---:|
| model | 100.09M | 100.09M | 100.09M |
| sequence length | 512 | 512 | 512 |
| microbatch | 2 | 4 | 8 |
| gradient accumulation | 32 | 16 | 8 |
| effective sequences/update | 64 | 64 | 64 |
| effective tokens/update | 32,768 | 32,768 | 32,768 |
| activation checkpointing | on | initially off | off |
| compile | off | off | off |
| manual attention | yes | yes | yes |

All profiles target:

\[
\boxed{32{,}768\text{ tokens/update}}
\]

where practical.

---

# 15. Phase 1 training contract

## 15.1 Optimizer — FROZEN

AdamW.

Reference values:

- learning rate: \(3\times10^{-4}\)
- beta1: 0.9
- beta2: 0.95
- epsilon: \(10^{-8}\)
- weight decay: 0.1
- gradient clipping: 1.0

## 15.2 Weight-decay grouping — FROZEN

\[
\dim(p)\ge2
\Rightarrow
\text{weight decay}
\]

\[
\dim(p)<2
\Rightarrow
\text{no weight decay}
\]

Thus matrix parameters decay; 1D RMSNorm weights do not.

## 15.3 Gradient accumulation — FROZEN

Each microbatch loss is divided by the accumulation count so accumulated gradients correspond to the intended effective batch.

## 15.4 Learning-rate schedule — FROZEN

Linear warmup followed by cosine decay to 10% of maximum LR.

The scheduler is intentionally implemented as a pure function of update number/configuration rather than an opaque mutable state machine.

## 15.5 Precision resolution — FROZEN

- CUDA + BF16 support → BF16 autocast
- CUDA without BF16 → FP16 autocast + GradScaler
- CPU → FP32

## 15.6 Gradient clipping order — FROZEN

For FP16:

1. forward under autocast;
2. scaled backward;
3. unscale;
4. measure/clip gradient norm;
5. optimizer step;
6. scaler update;
7. zero gradients.

---

# 16. Checkpoint/reproducibility contract

## 16.1 Checkpoint boundary — FROZEN

Core checkpoints are written only after a complete optimizer step.

No partially accumulated-gradient checkpoint is required in the core path.

## 16.2 Required checkpoint state — FROZEN

- model parameters;
- optimizer state;
- trainer counters;
- tokens seen;
- data-stream state;
- CPU RNG;
- CUDA RNG where relevant;
- GradScaler state where relevant;
- model config;
- train config;
- dataset identity;
- tokenizer identity;
- metadata.

## 16.3 Atomic checkpoint writing — FROZEN

Write temporary file → flush/complete → atomic rename.

## 16.4 Restart requirement — FROZEN

Interrupted/resumed training must reproduce uninterrupted training within the documented numerical tolerance.

---

# 17. KV-cache and generation contract

## 17.1 Cache shape — FROZEN

Per layer:

\[
K_l,V_l
\in
\mathbb R^{B\times H_{kv}\times T\times d_h}
\]

Canonical:

\[
H_{kv}=4,\quad d_h=64
\]

## 17.2 Cache allocation — FROZEN

Preallocate cache storage rather than repeatedly concatenating tensors.

## 17.3 Prefill/decode distinction — FROZEN

The course explicitly teaches:

\[
\boxed{\text{prefill}\neq\text{decode}}
\]

## 17.4 Cache equivalence — FROZEN

Cached and uncached logits must agree at every decode position within numerical tolerance.

## 17.5 Generation methods — FROZEN

Core generator supports:

- greedy decoding;
- temperature;
- top-k;
- top-p;
- EOS termination;
- seeded deterministic sampling.

---

# 18. Phase 1 assignments

The dependency chain is frozen:

\[
A1\rightarrow A2\rightarrow A3\rightarrow A4\rightarrow A5\rightarrow A6\rightarrow A7\rightarrow A8
\]

## A1 — Build BPE From Bytes — FROZEN

Covers:

- 256 byte IDs;
- learned merges;
- special-token handling;
- deterministic tie-breaking;
- Unicode round trips;
- save/load;
- tokenizer fertility.

Core invariant:

\[
\operatorname{decode}(\operatorname{encode}(x))=x
\]

## A2 — Causal GQA From Raw Tensors — FROZEN

Covers:

- Q/K/V;
- causal masking;
- multi-head attention;
- grouped-query attention;
- gradient validity;
- numerical reference equivalence;
- memory scaling.

Critical causal test:

changing future positions must not change earlier outputs.

## A3 — Assemble the 100M Decoder — FROZEN

Covers:

- RMSNorm;
- RoPE;
- SwiGLU;
- decoder blocks;
- stacking;
- tied output projection;
- parameter count;
- alternate small configurations.

## A4 — Build the Training System — FROZEN

Covers:

- AdamW grouping;
- accumulation;
- mixed precision;
- clipping;
- LR schedule;
- metric logging;
- token accounting.

## A5 — Checkpointing and Exact Restart — FROZEN

Covers:

- full state capture;
- deterministic data position;
- RNG restoration;
- restart equivalence;
- atomic persistence.

## A6 — KV Cache and Autoregressive Generation — FROZEN

Covers:

- prefill;
- decode;
- position correctness;
- cache equivalence;
- sampling;
- cache performance experiment.

## A7 — Evaluation, Diagnostics, and Failure Analysis — FROZEN

Covers:

- token-weighted NLL;
- perplexity for fixed tokenizer;
- diagnostics;
- deliberately broken implementations;
- memory characterization.

## A8 — Phase 1 Milestone — FROZEN

Integration gate composed of:

1. structural correctness;
2. tiny-data overfit;
3. canonical 100M stress test;
4. bounded natural-language sanity run.

---

# 19. Phase 1 testing philosophy

## 19.1 Public tests — FROZEN

Used to establish:

- interface;
- shapes;
- small numerical fixtures;
- debugging guidance.

## 19.2 Hidden tests — FROZEN

Used to test generality, not undocumented surprises.

Examples:

- randomized numerical references;
- causal leakage;
- gradient equivalence;
- weight-sharing identity;
- serialization;
- edge-case Unicode;
- memory constraints.

## 19.3 Hidden-test principle — FROZEN

A hidden test may not depend on an undocumented requirement.

## 19.4 Typical FP32 tolerance — FROZEN

Reference starting point:

\[
\text{atol}=10^{-5},
\qquad
\text{rtol}=10^{-4}
\]

Mixed-precision integration uses dtype-appropriate tolerances.

---

# 20. Phase 1 mastery gates

## Gate A — Correctness — FROZEN

All required primitives/integration tests pass.

## Gate B — Memorization — FROZEN

A deliberately small deterministic fixture is strongly overfit, proving that:

\[
\text{forward}
+
\text{loss}
+
\text{backward}
+
\text{optimizer}
\]

forms a functioning system.

## Gate C — 100M stress — FROZEN

The canonical model survives sustained training under the chosen hardware profile.

One successful forward pass is insufficient.

## Gate D — Natural-language sanity run — FROZEN

The canonical 100M model performs a bounded run demonstrating stable learning.

The objective is pipeline validation, not a competitive general-purpose language model.

---

# 21. Canonical Phase 1 corpus

## 21.1 Corpus choice — FROZEN

**TinyStories V2 GPT-4**

Pinned source:

`roneneldan/TinyStories`

Pinned revision:

`f54c09fd23315a6f9c86f9dc80f725de7d8f9c64`

The repository records the source identity and does not redistribute the raw dataset.

## 21.2 Core training-data accessibility path — FROZEN

Default core preparation uses a deterministic **64 MiB prefix** of the pinned training file, trimmed backward to the last complete story boundary.

The complete validation file is downloaded/verified separately.

## 21.3 Story boundary — FROZEN

Raw upstream `<|endoftext|>` separators are converted into the course’s canonical `<|end|>` control token in token artifacts.

---

# 22. Canonical tokenizer

## 22.1 Vocabulary — FROZEN

Total:

\[
32{,}000
\]

Eight IDs are reserved for course special/control tokens.

Initial special-token set:

- `<|bos|>`
- `<|eos|>`
- `<|pad|>`
- `<|system|>`
- `<|user|>`
- `<|assistant|>`
- `<|end|>`
- `<|reserved_0|>`

The exact chat-template use may evolve later, but the tokenizer machinery supports these from Phase 1.

## 22.2 Tokenizer semantics — FROZEN

- byte-level BPE;
- Unicode-aware GPT-2-style pretokenization boundaries for the canonical asset;
- byte fallback remains intact;
- deterministic merge training;
- deterministic serialized fingerprint.

## 22.3 Canonical tokenizer training subset — FROZEN

Default fit uses the first **100,000 complete training stories**.

## 22.4 Token artifact format — FROZEN

Because vocabulary < 65,536 IDs, prepared token artifacts may be stored compactly as `uint16` and converted to long tensors at runtime.

---

# 23. Phase 1 natural-language milestone budget

## 23.1 Execution budget — FROZEN

\[
512\text{ optimizer updates}
\times
32{,}768\text{ tokens/update}
=
\boxed{16{,}777{,}216\text{ training tokens}}
\]

## 23.2 Acceptance envelope — PROVISIONAL

Current sanity floor requires:

- exact canonical parameter count;
- at least 512 updates;
- at least 16,777,216 tokens;
- finite recorded losses;
- final validation loss below initial validation loss;
- at least 5% relative validation-loss reduction.

The 5% value is a pipeline-sanity floor, **not** the final pedagogical threshold.

Final thresholds require real 8/12/16 GB reference runs.

---

# 24. Hardware certification protocol

## 24.1 VRAM headroom target — PROVISIONAL DESIGN TARGET

\[
\frac{M_{\text{peak reserved}}}{M_{\text{device}}}
\le 0.85
\]

This is a design target, not a law and not a substitute for physical certification.

## 24.2 Required release matrix — FROZEN

Before promoting profiles from `candidate` to `certified`, collect:

- one older 8 GB NVIDIA path;
- one newer 8 GB NVIDIA path;
- one representative 12 GB NVIDIA path;
- one representative 16 GB NVIDIA path.

## 24.3 8 GB precision coverage — FROZEN

The 8 GB certification set must include:

- one BF16-capable sample;
- one BF16-unsupported sample;

so the FP16 + GradScaler fallback is empirically exercised.

## 24.4 Certification meaning — FROZEN

Certification means:

\[
\boxed{
\text{correctness}
+
\text{fit}
+
\text{sustained stability}
}
\]

It does not promise identical throughput across GPU generations.

---

# 25. Phase 1 repository

Canonical project structure:

```text
first-principles-llm-research/
├── configs/
│   ├── data/
│   ├── model/
│   ├── hardware/
│   ├── training/
│   └── qualification/
├── src/fpllm/
│   ├── tokenizer/
│   ├── model/
│   ├── data/
│   ├── training/
│   ├── inference/
│   ├── certification.py
│   └── release.py
├── tests/public/
├── experiments/
│   ├── memory_probe/
│   ├── tiny_overfit/
│   └── phase1_milestone/
├── scripts/
├── research_log/
├── DATASET.md
├── CERTIFICATION.md
└── BUILD_STATUS.md
```

## Implementation status — CURRENT

The built Phase 1 repository has reached v0.3.0 and includes:

- canonical 100M model;
- parameter accounting;
- RMSNorm;
- RoPE;
- SwiGLU;
- causal GQA;
- tokenizer;
- training system;
- gradient accumulation;
- mixed precision;
- activation checkpointing;
- deterministic token stream;
- atomic checkpoints;
- KV cache;
- generation;
- evaluation;
- TinyStories preparation;
- tokenizer asset building;
- milestone training;
- qualification;
- release-matrix aggregation.

Latest implemented public test suite:

**38/38 passing** at the time this decision register was created.

Physical CUDA certification remains outstanding.

---

# 26. Phase 2 — Optimize

## Governing question — FROZEN

**Where does computation actually go?**

## Topics — FROZEN

- profiling;
- FLOPs vs bandwidth;
- arithmetic intensity;
- HBM ↔ SRAM;
- kernel launch overhead;
- memory layout;
- coalescing;
- Triton;
- tiles;
- online softmax;
- fused attention;
- mixed precision;
- activation checkpointing;
- DDP;
- FSDP/ZeRO;
- tensor parallelism.

## Systems learning sequence — FROZEN

Distributed progression:

\[
\text{DDP}
\rightarrow
\text{FSDP}
\rightarrow
\text{TP}
\]

Optional later topics:

- pipeline parallelism;
- context parallelism.

## Optimization benchmark philosophy — FROZEN

Do not require an arbitrary “2–4× speedup.”

Instead require statistically reproducible improvements against clearly defined baselines plus explanation using:

- memory traffic;
- fusion;
- occupancy;
- communication;
- compute.

Reference sequence:

\[
\text{naïve PyTorch}
\rightarrow
\text{optimized PyTorch}
\rightarrow
\text{custom Triton}
\]

---

# 27. Phase 3 — Scale

## Governing question — FROZEN

**What determines performance before training?**

## Data pipeline — FROZEN

\[
D_0
\rightarrow
\text{parse}
\rightarrow
\text{normalize}
\rightarrow
\text{filter}
\rightarrow
\text{deduplicate}
\rightarrow
\text{mix}
\rightarrow
D_{\text{train}}
\]

Metadata should include:

- provenance;
- language;
- domain;
- quality score;
- dedup group/cluster;
- token count;
- processing version;
- mixture category;
- license where available.

## Data topics — FROZEN

- web/document parsing;
- PDFs/Markdown/LaTeX;
- language identification;
- quality filtering;
- MinHash/LSH;
- contamination;
- domain mixtures;
- provenance.

## Scaling-law experiment — FROZEN DIRECTION

Representative model grid:

\[
N\in\{10M,20M,40M,80M,160M\}
\]

with token/model ratios such as:

\[
D/N\in\{5,10,20,40,\ldots\}
\]

Fit a form such as:

\[
L(N,D)
=
L_\infty
+
AN^{-\alpha}
+
BD^{-\beta}
\]

and use it to make a pre-registered prediction for a withheld run.

## Important data-scale principle — FROZEN

Students may build a 5B+ token data pipeline without being required to pretrain over every token.

Pipeline scale and consumed training tokens are distinct.

---

# 28. Phase 4 — Post-Train

## Governing question — FROZEN

**How can model behavior be deliberately changed after pretraining?**

## Conceptual sequence — FROZEN

\[
\text{Base LM}
\rightarrow
\text{SFT}
\rightarrow
\text{Offline Preference Optimization}
\rightarrow
\text{Online RL}
\rightarrow
\text{RLVR}
\]

## SFT — FROZEN

Covers:

- instruction formats;
- packing;
- prompt masking;
- LoRA;
- QLoRA.

## Preference optimization — FROZEN

DPO is a core method.

SimPO/ORPO are candidates for comparative study.

## RL — FROZEN

Covers:

- sampling;
- rewards;
- advantages;
- KL control;
- online policy updates.

## RLVR — FROZEN

Uses objective/auditable verifiers where possible.

Candidate domains:

- math;
- code;
- symbolic tasks;
- games;
- programmatic environments.

## Controlled comparison — FROZEN

Where practical, compare descendants of the same base:

\[
M_0
\rightarrow
\{
M_{\text{SFT}},
M_{\text{Pref}},
M_{\text{RLVR}}
\}
\]

on the same held-out task distribution.

---

# 29. Phase 5 — Agent

## Governing question — FROZEN

**What changes when the model acts in an environment?**

## Formal environment — FROZEN

\[
E=(S,A,T,R,O)
\]

## Difficulty parameters — FROZEN

At minimum:

- \(H\): decision horizon;
- \(B\): branching factor;
- \(D\): distractors;
- \(M\): memory requirement.

Study:

\[
P(\text{success}\mid H,B,D,M)
\]

## Failure analysis — FROZEN

Include:

- compounding errors;
- invalid actions;
- state loss;
- reward exploitation;
- tool-use errors;
- recovery behavior;
- distribution shift;
- premature termination.

## Gate — FROZEN

Produce systematic capability/failure curves and test generalization beyond the training distribution.

---

# 30. Phase 6 — Science

## Governing question — FROZEN

**What new claim does the evidence support?**

## Topics — FROZEN

- experimental design;
- hypotheses;
- baselines;
- ablations;
- uncertainty;
- visualization;
- scientific writing;
- reproducibility;
- peer review.

## Final paper structure — FROZEN

- Abstract
- Introduction
- Related Work
- Method
- Experimental Setup
- Results
- Analysis
- Limitations
- Conclusion
- Reproducibility Statement

---

# 31. Research journal

## Research journal fields — FROZEN

Every entry should support:

- Question
- Hypothesis
- Configuration
- Prediction
- Observation
- Result
- Interpretation
- Failure / uncertainty
- Next experiment

By Phase 6, the journal should feed directly into the paper/capstone.

---

# 32. Learning platform product model

The website is explicitly **not** a conventional content-viewing LMS.

The product is designed as:

\[
\boxed{
\text{Course}
+
\text{Lab}
+
\text{Research}
}
\]

supported by an:

\[
\boxed{\text{Execution \& Evidence Layer}}
\]

## Course surface — FROZEN

Answers:

**What do I need to understand?**

Contains:

- concepts;
- lessons;
- mathematics;
- diagrams;
- readings;
- structured checks.

## Lab surface — FROZEN

Answers:

**Can I make it work?**

Contains:

- assignments;
- repository state;
- commands;
- public tests;
- hidden-test status;
- experiments;
- submissions.

## Research surface — FROZEN

Answers:

**What does the evidence mean?**

Contains:

- journal;
- hypotheses;
- results;
- Research Selection Gate;
- capstone;
- paper/reproduction artifacts.

## Evidence layer — FROZEN

Supports:

- Git commit identity;
- test results;
- configs;
- hardware profile;
- metrics;
- datasets;
- tokenizer identity;
- qualification reports;
- experiment artifacts.

---

# 33. Platform pedagogical doctrine

These are frozen product principles:

> **Content consumption is not mastery.**

> **Every important implementation has an executable correctness criterion.**

> **Every important experiment produces persistent evidence.**

> **Failure is diagnostic information, not merely a red status.**

> **Hardware differences alter execution strategy, not intellectual expectations.**

> **Learner autonomy increases as demonstrated competence increases.**

> **Research claims remain connected to the experiments that support them.**

---

# 34. Platform execution philosophy

## Local-first, web-coordinated — FROZEN

\[
\boxed{\text{Local-first, web-coordinated}}
\]

The platform should not hide the development/research environment from learners.

Students should learn and use:

- Git;
- terminal workflows;
- Python environments;
- CUDA;
- profiling tools;
- file organization;
- experiment management.

A browser IDE is **not** an MVP requirement.

---

# 35. Primary student navigation

Main navigation is frozen as:

1. **Home**
2. **Learn**
3. **Lab**
4. **Research**
5. **Progress**

Profile, compute, settings, repository management, and account controls sit outside the primary learning navigation.

---

# 36. Desktop application shell

## Three-region architecture — FROZEN

Desktop layout:

1. **Left:** persistent navigation
2. **Center:** active workspace
3. **Right:** contextual panel

The contextual panel may display:

- current objective;
- hardware profile;
- mastery requirements;
- current experiment;
- Git commit;
- evidence;
- notes.

A minimal top bar contains:

- product identity;
- search/command palette;
- compute status;
- sync;
- user controls.

---

# 37. Learner dashboard

The dashboard is an operational command center, not a marketing/news feed.

Primary hierarchy:

1. Continue current work
2. Current mastery state
3. Latest experimental evidence
4. Open research work
5. Hardware/compute profile

Avoid:

- generic motivational cards;
- news feeds;
- content carousels;
- streak pressure.

---

# 38. Course map

## Dependency graph — FROZEN

Course structure is represented by capability dependencies rather than only a linear module list.

Learning content may be read ahead.

Mastery-dependent labs may be locked until prerequisites are satisfied.

Policy:

\[
\boxed{
\text{soft content access}
+
\text{hard mastery prerequisites}
}
\]

---

# 39. Atomic learning object

The fundamental content object is a **Learning Unit**, not a video.

A Learning Unit contains:

- Question
- Objectives
- Explanation
- Mathematics
- Visualization
- Worked example
- Implementation bridge
- Conceptual check
- Lab
- Experiment
- Interpretation
- Mastery gate
- Optional extension

Typical section navigation:

1. Intuition
2. Formalism
3. Tensor mechanics/shapes
4. Implementation
5. Failure modes
6. Lab
7. Experiment
8. Interpretation
9. Mastery

Viewing sections does not equal mastery.

---

# 40. Mathematical teaching interaction

A signature interaction should connect:

\[
\boxed{
\text{Equation}
\rightarrow
\text{Tensor shapes}
\rightarrow
\text{Concrete example}
\rightarrow
\text{Implementation}
}
\]

Example UI controls:

- Show shapes
- Show numerical example
- Show implementation

Code examples may expose:

- Conceptual
- Minimal
- Repository

views.

---

# 41. Lab object

A Lab contains:

- objective;
- prerequisites;
- repository state;
- required interfaces;
- constraints;
- hardware profile;
- starter command;
- public tests;
- required experiment;
- submission;
- hidden tests;
- interpretation;
- mastery result.

Lab requirements should be explicit and checklist-like.

---

# 42. Submission identity

## Git commit as immutable submission identity — FROZEN

A submission references:

- repository;
- branch;
- commit SHA;
- course version;
- lab version.

Future commits do not mutate an already submitted attempt.

This is a core reproducibility principle.

---

# 43. Public vs hidden test UX

## Public tests — FROZEN

Visible and actionable.

## Hidden tests — FROZEN

Show:

- pass/fail;
- relevant documented invariant;
- diagnostic category;

without exposing hidden fixtures or solution code.

Failure feedback should point to the violated contract.

---

# 44. Assistance ladder

Failure assistance should be progressive:

1. relevant invariant;
2. diagnostic question;
3. conceptual hint;
4. worked analogous example;
5. deeper help if explicitly requested.

The platform should not immediately reveal the solution.

---

# 45. Experiment object

A platform experiment contains:

- Experiment ID
- Question
- Hypothesis
- Git commit
- Model config
- Training config
- Hardware
- Dataset version
- Tokenizer fingerprint
- Seed
- Metrics
- Artifacts
- Observation
- Interpretation
- Status

Prediction/hypothesis should be lockable before execution.

The experiment result interface separates:

1. Prediction
2. Measurement
3. Interpretation
4. Conclusion

The learner may classify a result as:

- supports;
- partially supports;
- does not support;
- inconclusive.

The platform should not describe hypotheses as “proven.”

---

# 46. Research journal UX

The Research Journal is a core platform feature, not a side document.

Machine-derived metadata should be auto-populated:

- Git commit;
- dataset;
- tokenizer hash;
- seed;
- GPU;
- CUDA;
- PyTorch;
- run ID.

Learner attention should be reserved for:

- hypothesis;
- prediction;
- interpretation;
- uncertainty;
- next experiment.

Failed/negative experiments remain visible.

---

# 47. Mastery model

Unit mastery may require evidence across:

| Dimension | Evidence |
|---|---|
| Conceptual | explanation/check |
| Implementation | required interface |
| Correctness | public tests |
| Generality | hidden tests |
| Experimental | required run |
| Interpretation | written analysis |

State transition:

\[
\text{Not Started}
\rightarrow
\text{In Progress}
\rightarrow
\text{Evidence Submitted}
\rightarrow
\text{Mastered}
\]

---

# 48. Status vocabulary

## Learning units — FROZEN

- Not started
- Learning
- Implementing
- Experimenting
- Awaiting mastery
- Mastered

## Experiments — FROZEN

- Draft
- Locked
- Running
- Complete
- Interpreted
- Failed

## Submissions — FROZEN

- Draft
- Submitted
- Testing
- Needs revision
- Passed

## Research — FROZEN

- Question
- Hypothesis
- Testing
- Supported
- Not supported
- Inconclusive

---

# 49. Progress representation

Avoid one dominant percentage.

Progress should expose multiple dimensions, e.g.:

- Concepts
- Implementation
- Experiments
- Mastery
- Research journal

A small aggregate may exist, but it should not conceal these distinctions.

---

# 50. Hardware as persistent UX context

The learner profile should retain:

- detected GPU;
- VRAM;
- CUDA;
- BF16 support;
- precision path;
- selected course hardware profile.

Detected hardware and selected course profile are distinct.

A learner with more hardware may deliberately select an 8 GB profile.

---

# 51. Technical onboarding

Initial flow:

1. account/enrollment;
2. choose achievement track;
3. connect GitHub/repository;
4. run environment probe;
5. detect/select compute profile;
6. clone course repository;
7. run qualification;
8. enter first technical task.

Onboarding should diagnose and explain rather than simply pass/fail.

Example:

> Your GPU has 8 GB and does not support BF16. The course will use the 8 GB FP16 + GradScaler configuration.

---

# 52. Platform screen set

The currently defined screens are:

1. Public landing page
2. Enrollment / track selection
3. Technical onboarding
4. Repository setup
5. Learner dashboard
6. Course map
7. Learning Unit
8. Lab workspace
9. Test results
10. Experiment setup
11. Experiment results
12. Research Journal
13. Progress / mastery
14. Research Selection Gate
15. Capstone workspace

---

# 53. UX details frozen so far

## Loading states

When possible, show discrete work stages instead of indefinite spinners.

## Error states

Every useful error should communicate:

\[
\boxed{
\text{what failed}
+
\text{likely reason}
+
\text{evidence}
+
\text{next action}
}
\]

## Empty states

Explain the next meaningful action rather than decorate the screen.

## Search

Search should eventually span:

- learning units;
- experiments;
- journal;
- readings;
- code references.

## Command palette

`Ctrl-K` / `Cmd-K` is planned for fast navigation/actions.

## Notifications

Sparse and operational.

Useful:

- test completed;
- reviewer feedback;
- proposal needs revision;
- hosted lab ready.

Avoid engagement-pressure notifications.

---

# 54. Mobile and responsive policy

## Mobile — FROZEN DIRECTION

Strong support for:

- learning;
- reading;
- research journal;
- progress;
- experiment review.

Lab/code work is specification/read-only oriented.

The product should not pretend a phone is an appropriate primary coding interface.

## Tablet — FROZEN DIRECTION

Two-pane layout where possible; contextual panel becomes a drawer.

## Desktop — FROZEN

Primary environment for labs, experiments, comparison, and capstone work.

---

# 55. Accessibility

Minimum product contract:

- keyboard navigation;
- visible focus states;
- semantic headings/landmarks;
- accessible math where feasible;
- captions/transcripts;
- sufficient contrast;
- code-block keyboard usability;
- chart data tables;
- no color-only distinctions;
- reduced-motion support;
- resizable typography;
- descriptive test/error messages.

---

# 56. Privacy and visibility

Learner-created technical/research artifacts default to:

\[
\boxed{\text{Private}}
\]

Visibility states:

- Private
- Shared with reviewer
- Public

Public sharing must be deliberate.

Hardware metadata collection should be limited to technically relevant properties.

---

# 57. Product visual doctrine

The platform should feel like:

\[
\boxed{\text{a scientific instrument}}
\]

Desired qualities:

- precise;
- calm;
- technical;
- high-information;
- dense when useful;
- deliberate.

Avoid an aesthetic dominated by:

- neon “AI” styling;
- gaming UI;
- badge-heavy design;
- generic marketing;
- excessive gamification.

---

# 58. Gamification policy

Avoid:

- arbitrary XP;
- streak pressure;
- leaderboard ranking by speed;
- badges for content consumption.

Prefer meaningful technical milestones such as:

- Tokenizer validated
- 100M architecture passed
- KV cache verified
- Phase 1 mastered
- Research proposal accepted
- Reproduction package completed

---

# 59. UX scaffolding over the course

The product becomes less prescriptive as competence increases:

| Phase | UX character |
|---|---|
| 0 | highly guided |
| 1 | guided implementation |
| 2 | guided measurement |
| 3 | controlled experimental choice |
| 4 | increasing methodological choice |
| 5 | open experimental design |
| 6 | research workspace |

Overall:

\[
\boxed{
\text{instruction}
\rightarrow
\text{scaffolding}
\rightarrow
\text{autonomy}
}
\]

---

# 60. Capstone UX

Phase 6 becomes argument-centric.

Core capstone objects:

- Research Question
- Hypothesis
- Environment
- Baselines
- Experiments
- Ablations
- Figures
- Claims
- Contradictory evidence
- Limitations
- Paper
- Reproduction package

Claims should remain connected to supporting and contradictory experiments.

The initial platform does **not** need a full academic rich-text editor.

Exporting a structured Markdown/LaTeX research package is sufficient for an early version.

---

# 61. Platform data model

High-level entities identified so far:

- User
- Course
- CourseVersion
- Phase
- LearningUnit
- Lab
- MasteryGate
- Enrollment
- HardwareProfile
- Repository
- Submission
- TestRun
- Experiment
- ExperimentArtifact
- ResearchJournalEntry
- ResearchProposal
- Capstone
- Credential

Critical chain:

\[
\text{LearningUnit}
\rightarrow
\text{Lab}
\rightarrow
\text{Submission}
\rightarrow
\text{Experiment}
\rightarrow
\text{JournalEntry}
\]

---

# 62. Content architecture

Course source should be structured and version-controlled rather than authored only inside an opaque CMS.

Proposed form:

```text
course/
└── phase1/
    └── attention/
        ├── unit.yaml
        ├── lesson.mdx
        ├── diagrams/
        ├── lab.yaml
        ├── experiment.yaml
        ├── mastery.yaml
        └── readings.yaml
```

Benefits:

- version control;
- reviewability;
- reproducible builds;
- branching;
- technical contributor workflows.

---

# 63. Content/version identities

Every artifact should eventually carry version identity such as:

- course version;
- phase version;
- unit version;
- lab version;
- test version;
- dataset version.

Historical submissions must remain interpretable after the course evolves.

---

# 64. MVP platform boundary

## Include — FROZEN

- accounts/enrollment;
- course map;
- versioned lessons;
- lab specifications;
- hardware profile;
- Git commit submission;
- public/hidden test result display;
- experiment setup/result flow;
- research journal;
- mastery gates;
- progress dashboard.

## Defer — FROZEN

- browser IDE;
- managed GPU fleet;
- real-time collaborative coding;
- complex social feed;
- full paper editor;
- peer-review marketplace;
- extensive gamification;
- mobile coding;
- generalized LMS features.

---

# 65. First vertical prototype

## Prototype choice — FROZEN

**Phase 1 — Causal Attention**

The vertical slice must exercise:

\[
\text{Dashboard}
\rightarrow
\text{Attention Learning Unit}
\rightarrow
\text{Attention Lab}
\rightarrow
\text{Git Submission}
\rightarrow
\text{Public/Hidden Tests}
\rightarrow
\text{Memory Experiment}
\rightarrow
\text{Results}
\rightarrow
\text{Interpretation}
\rightarrow
\text{Mastery}
\rightarrow
\text{Journal Entry}
\]

## Prototype learning objective — FROZEN

> Implement causal grouped-query self-attention from raw PyTorch tensor operations and experimentally characterize its sequence-length memory scaling.

## Prototype public checks — FROZEN

- shape correctness;
- causal non-leakage;
- GQA/reference equivalence;
- gradient propagation.

## Prototype experiment — FROZEN

Sequence lengths:

\[
S\in\{128,256,512,1024\}
\]

Learner explains the observed relationship between sequence length and peak memory, including why real ratios may not be exactly \(4\times\).

---

# 66. UX success criteria for the vertical slice

A technically capable beta learner should be able to complete the following without instructor intervention:

1. understand the objective;
2. know what to implement;
3. locate equations and tensor shapes;
4. run public tests;
5. understand a failure;
6. submit an immutable commit;
7. run the experiment;
8. import/synchronize results;
9. interpret evidence;
10. understand why mastery was or was not granted.

If the platform itself requires instructor explanation, the UX has failed.

---

# 67. Product metrics

Do **not** optimize primarily for:

- minutes watched;
- login streak;
- clicks;
- raw content completion.

Prefer:

- mastery-gate completion;
- lab success after iteration;
- experiment completion;
- explanation completion;
- phase transition;
- research proposal completion;
- capstone reproducibility.

Time spent away from the website may be productive local research work.

---

# 68. Decisions explicitly superseded

The following earlier ideas are no longer authoritative:

### Superseded
“Primary compute target: one 16–24 GB CUDA GPU.”

### Replaced by
8 GB Minimum / 12 GB Standard / 16 GB Reference.

---

### Superseded
“2–4× Phase 2 speedup” as a required fixed milestone.

### Replaced by
Measured, reproducible improvement against explicitly defined baselines plus systems explanation.

---

### Superseded
“5–10B tokens” as an obligatory amount every learner must actually train over.

### Replaced by
Versioned large-scale data-pipeline construction with controlled, affordable consumed-token experiments.

---

### Superseded
`<thought>` output as evidence of reasoning.

### Replaced by
Verified task success, generalization, failure analysis, reward-hacking checks, length/cost analysis.

---

### Superseded
One final “Research” phase containing both agent-building and science.

### Replaced by
Separate Phase 5 Agent and Phase 6 Science.

---

# 69. Current open items

The following are **not yet fully decided or empirically closed**.

## 69.1 Phase 1 physical certification — OPEN EMPIRICAL TASK

Run the 8/12/16 GB qualification matrix on real NVIDIA hardware.

Potential consequence:

- hardware overlay parameters may be tuned before certification.

## 69.2 Final Phase 1 natural-language acceptance envelope — OPEN EMPIRICAL TASK

Replace the provisional 5% loss-reduction floor using measured reference runs.

## 69.3 Phase 2 detailed curriculum/repository specification — OPEN

High-level Phase 2 decisions are frozen; implementation-resolution specification remains to be written.

## 69.4 Website Interaction & Wireframe Specification v1.0 — NEXT DESIGN TASK

The next website-design document should define the Causal Attention vertical slice at wireframe/interaction resolution, including:

- concrete layout dimensions;
- component hierarchy;
- routes/transitions;
- button behavior;
- forms;
- side-panel states;
- test-result states;
- experiment chart placement;
- desktop/tablet/mobile wireframes.

## 69.5 Production web technology stack — OPEN

No frontend/backend framework has yet been frozen for the learning platform.

## 69.6 Authentication/payment/commerce — OPEN

Enrollment/product strategy is described, but production billing/auth architecture has not yet been frozen.

## 69.7 Reviewer/instructor tooling — PARTIALLY DEFINED

The reviewer information model is clear; detailed reviewer workflows and screens remain open.

## 69.8 Hosted compute provider/integration — OPEN

Hosted compute is part of the accessibility strategy, but no specific provider is yet a platform dependency.

---

# 70. Current project next-step sequence

The currently implied order is:

1. **Preserve this consolidated decision register as an authoritative project file.**
2. Complete **Interaction & Wireframe Specification v1.0** for the Causal Attention vertical slice.
3. Use that vertical slice to define the initial web component system and frontend architecture.
4. Continue Phase 1 empirical hardware certification in parallel when suitable GPUs are available.
5. Freeze Phase 1 certified profiles and final natural-language acceptance envelope from measured results.
6. Begin detailed **Phase 2 — Optimize Curriculum & Implementation Specification** using the Phase 1 implementation as the deliberately transparent baseline.
7. Expand the website from the successful Attention vertical slice rather than designing all screens independently.

---

# 71. One-sentence project definition

**First Principles LLM Research is a self-paced, mastery-based research course and learning platform in which students build a modern language model from raw tensors, measure and optimize its systems behavior, study data scaling and post-training, construct verifiable agent environments, and ultimately support an original scientific claim with reproducible evidence.**

---

# 72. Frozen high-level project doctrine

The project can be summarized by the following constraints:

\[
\boxed{
\text{Build it}
\rightarrow
\text{verify it}
\rightarrow
\text{measure it}
\rightarrow
\text{explain it}
\rightarrow
\text{research with it}
}
\]

with:

\[
\boxed{
8\text{ GB}
\;|\;
12\text{ GB}
\;|\;
16\text{ GB}
}
\]

as the core hardware design envelope, and:

\[
\boxed{
\text{Course}
+
\text{Lab}
+
\text{Research}
+
\text{Evidence}
}
\]

as the learning-platform architecture.

---

---

# 73. Web platform technical architecture — NEW IN v1.1

The implementation architecture for the first web vertical slice is now frozen at the following level.

## 73.1 Runtime/application stack — FROZEN

- Node.js 24 LTS
- TypeScript 5.9+ with strict typing
- Next.js 16.x App Router
- React 19.3-compatible
- pnpm workspaces
- Turborepo

Exact patch versions are lockfile concerns and must receive normal security updates.

## 73.2 UI/component stack — FROZEN

- Tailwind CSS 4.x
- Radix Primitives as the accessibility/behavior primitive layer
- project-owned component wrappers and CSS design tokens
- shadcn components/CLI may be used as source scaffolding, but shadcn does not define the product visual identity

The exact visual color/typography values remain open until visual design.

## 73.3 Content implementation — FROZEN

Course content is Git-versioned MDX 3 plus validated YAML/JSON metadata.

Trusted course content may embed an allowlisted component set.

Learner-authored hypotheses, journal entries, and interpretations must never execute as MDX/JSX; they use sanitized Markdown/structured text.

## 73.4 Persistence — FROZEN

- PostgreSQL 18.x is the system of record.
- Prisma ORM 7.x is the first production data-mapping baseline.
- Prisma 8 is not adopted while it remains release-candidate software.
- Large artifacts use S3-compatible object storage.
- PostgreSQL provides the initial durable job queue and search implementation; Redis/OpenSearch are not MVP requirements.

## 73.5 GitHub integration — FROZEN

Repository access uses a GitHub App with least-privilege, repository-specific permissions rather than broad OAuth `repo` access.

Platform authentication remains a separate concern and the production identity provider remains open.

## 73.6 Untrusted-code execution — FROZEN

Learner repository code never executes in the web process.

Hidden/public qualification requiring repository execution runs in a separate worker using an ephemeral isolated sandbox with:

- no platform secrets;
- network disabled by default;
- non-root execution;
- CPU/RAM/PID/time limits;
- read-only hidden tests;
- disposable filesystem;
- complete teardown after the run.

The exact production sandbox technology/provider remains open.

## 73.7 API and live progress — FROZEN

A stable JSON API is exposed under `/api/v1` for the Python `fpllm` CLI and future integrations.

Test-run progress uses persisted job events plus Server-Sent Events, with polling fallback.

## 73.8 Evidence/mastery architecture — FROZEN

Submissions, locked experiment predictions, completed test results, artifact hashes, and finalized interpretations are versioned/append-oriented evidence.

Mastery is computed server-side from evidence and a versioned mastery policy. The client cannot directly set a unit to mastered.

## 73.9 Web testing baseline — FROZEN

- Vitest + Testing Library for unit/component tests
- Playwright for end-to-end flows
- automated accessibility checks plus manual keyboard/screen-reader review

## 73.10 Provider choices still open — OPEN

Not yet frozen:

- hosting provider;
- PostgreSQL provider;
- S3 provider;
- auth provider;
- payment provider;
- production sandbox provider;
- chart library;
- hosted GPU provider.

---

# 74. Revised current next-step sequence — v1.1

1. Preserve this v1.1 decision register and the two platform specifications.
2. Build **Causal Attention Web Prototype Scaffold v0.1** using fixture/mock backend data first.
3. Implement the real course-content pipeline and design-system primitives.
4. Validate the learner UX end to end before wiring costly infrastructure.
5. Add PostgreSQL persistence and artifact storage.
6. Add GitHub App repository binding and immutable commit submissions.
7. Add the isolated test worker and hidden-test pipeline.
8. Continue Phase 1 8/12/16 GB empirical hardware certification in parallel.
9. Freeze final Phase 1 hardware profiles and natural-language acceptance envelope from measured results.
10. Begin the detailed Phase 2 curriculum/repository specification.

---

**End of Consolidated Decision Register v1.1**
