# First Principles LLM Research
## Interaction & Wireframe Specification v1.0

**Document version:** 1.0  
**Date:** 2026-09-18  
**Scope:** Phase 1 Causal Attention vertical slice  
**Status:** Implementation-ready UX specification  
**Authoritative dependency:** Consolidated Decision Register & Project Specification v1.0

---

# 0. Purpose

This document turns the already-decided learning-platform and UX principles into a concrete interaction contract for the first production vertical slice:

\[
\boxed{\text{Phase 1 — Causal Attention}}
\]

The slice must exercise the entire product loop:

\[
\text{Dashboard}
\rightarrow
\text{Learning Unit}
\rightarrow
\text{Lab}
\rightarrow
\text{Git Submission}
\rightarrow
\text{Tests}
\rightarrow
\text{Experiment}
\rightarrow
\text{Results}
\rightarrow
\text{Interpretation}
\rightarrow
\text{Mastery}
\rightarrow
\text{Journal}
\]

The purpose of this specification is to make frontend implementation possible without requiring additional product interpretation.

It deliberately does **not** select a frontend framework, backend framework, authentication provider, payment provider, or managed-compute provider.

---

# 1. Governing product constraints

The interaction design must preserve these project constraints:

1. **Content consumption is not mastery.**
2. **Local-first, web-coordinated execution.**
3. **Git commit is immutable submission identity.**
4. **Public tests are visible; hidden tests report violated documented invariants without leaking fixtures.**
5. **Prediction precedes measurement.**
6. **Experiments produce persistent structured evidence.**
7. **Hardware changes execution strategy, not intellectual expectations.**
8. **Learner-created research artifacts are private by default.**
9. **Failure states are diagnostic, not punitive.**
10. **The visual character is a scientific instrument, not a gaming dashboard.**
11. **Desktop is the primary lab environment; mobile supports learning/review rather than primary coding.**
12. **The platform gradually reduces scaffolding as learner competence increases.**

---

# 2. Vertical-slice learning objective

The prototype uses the following real course objective:

> Implement causal grouped-query self-attention from raw PyTorch tensor operations and experimentally characterize its sequence-length memory scaling.

The public correctness checks are:

- shape correctness;
- causal non-leakage;
- GQA/reference equivalence;
- gradient propagation.

The required experiment evaluates:

\[
S\in\{128,256,512,1024\}
\]

and asks the learner to explain:

- why naïve attention memory contains a quadratic component;
- why empirical ratios are not necessarily exactly \(4\times\) when sequence length doubles;
- which other memory terms and runtime effects contribute.

---

# 3. Route map

The vertical slice should be implementable with these routes.

```text
/
├── /home
├── /learn
│   └── /phase-1/causal-attention
├── /lab
│   └── /phase-1/causal-attention
│       ├── /submission/:submissionId
│       └── /tests/:testRunId
├── /experiments
│   └── /attention-memory-scaling
│       ├── /new
│       └── /:experimentId
├── /research
│   └── /journal
│       └── /:entryId
├── /progress
│   └── /phase-1
├── /setup
│   ├── /compute
│   └── /repository
└── /settings
    ├── /compute
    └── /repository
```

Route aliases may later change, but the interaction graph should remain stable.

---

# 4. Global shell

## 4.1 Desktop viewport target

Primary design target:

```text
1440 × 900
```

Minimum fully supported desktop width:

```text
1180 px
```

The interface must remain usable on larger ultrawide displays without allowing the reading column to become excessively wide.

## 4.2 Desktop shell dimensions

Recommended baseline geometry:

```text
Top bar              56 px
Left navigation     224 px
Right context       304 px
Workspace           remaining width
Bottom status bar    28 px optional
```

At 1440 px:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Top bar — 56 px                                                             │
├───────────────┬─────────────────────────────────────────────┬────────────────┤
│ Left nav      │ Main workspace                              │ Context panel  │
│ 224 px        │ ~880 px                                     │ 304 px         │
│               │                                             │                │
│               │                                             │                │
│               │                                             │                │
├───────────────┴─────────────────────────────────────────────┴────────────────┤
│ Optional status rail — 28 px                                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 4.3 Workspace width rules

Reading content should use:

```text
max text measure ≈ 760 px
```

Technical tables, code, graphs, and tensor visualizations may use the full workspace width.

## 4.4 Left navigation

Persistent items:

```text
Home
Learn
Lab
Research
Progress
```

Secondary controls at bottom:

```text
Compute
Repository
Settings
```

The active destination gets both a visible state and an accessible current-page semantic.

## 4.5 Top bar

Contains:

```text
[FPLLM wordmark]
[Course / Phase context]
[Search / Command palette trigger]

[Compute badge]
[Sync state]
[User menu]
```

The compute badge is always visible on desktop.

Example:

```text
8 GB · FP16
```

Expanding it reveals:

```text
GPU: RTX 3070
Course profile: 8 GB Minimum
Precision: FP16 + GradScaler
CUDA: available
```

## 4.6 Context panel

The right panel changes by active object but has stable sections:

```text
Current objective
Operational context
Mastery / gate state
Evidence / provenance
Notes / shortcuts
```

The context panel may collapse at widths below 1280 px.

---

# 5. Responsive shell

## 5.1 Tablet

Target width:

```text
768–1179 px
```

Behavior:

- left navigation becomes a compact icon rail or drawer;
- context panel becomes a slide-over drawer;
- workspace occupies remaining width;
- top bar keeps compute status and search.

## 5.2 Mobile

Below approximately 768 px:

- primary navigation becomes bottom navigation or drawer;
- context panel becomes a modal/drawer;
- lab pages become read/specification-oriented;
- large charts become horizontally scrollable or stacked;
- code editing is not introduced;
- clear banner may state: “This lab is designed for desktop development.”

---

# 6. Visual information hierarchy

Four hierarchy levels are frozen for the prototype.

## Level 1 — Current task

Highest prominence:

- current learning objective;
- current lab state;
- required next action.

## Level 2 — Scientific content

- equations;
- tensor shapes;
- code;
- experimental results;
- graphs;
- interpretations.

## Level 3 — Operational metadata

- commit SHA;
- hardware profile;
- dataset/tokenizer identity;
- run ID;
- course/lab version.

## Level 4 — Platform chrome

- account;
- settings;
- sync;
- navigation utilities.

Scientific work must remain visually dominant over platform machinery.

---

# 7. Core component inventory

## 7.1 Navigation

```text
AppShell
TopBar
PrimaryNav
ContextPanel
Breadcrumbs
CommandPalette
MobileNav
```

## 7.2 Learning content

```text
LearningUnitHeader
SectionRail
ProseBlock
EquationBlock
TensorShapeTable
CodeExample
CodeViewTabs
ConceptCheck
WorkedExample
FailureModeCallout
ReadingReference
```

## 7.3 Lab

```text
LabHeader
RequirementChecklist
ConstraintPanel
CommandBlock
RepositoryIdentityCard
SubmissionCard
TestSummary
TestResultRow
HiddenTestFailure
AssistanceLadder
```

## 7.4 Experiment

```text
ExperimentHeader
HypothesisForm
PredictionForm
VariableTable
ExperimentLockBanner
RunCommandCard
ArtifactImport
MetricTable
ExperimentChart
InterpretationForm
ConclusionSelector
ProvenancePanel
```

## 7.5 Research/mastery

```text
JournalTimeline
JournalEntryCard
JournalEntryEditor
MasteryMatrix
MasteryGateCard
ProgressDimensionBar
EvidenceLink
```

## 7.6 Operational

```text
ComputeBadge
ComputeProfileCard
SyncIndicator
StatusBadge
ErrorDiagnostic
LoadingStepper
EmptyState
Toast/Notification
```

---

# 8. State model

## 8.1 Learning unit states

```text
not_started
learning
implementing
experimenting
awaiting_mastery
mastered
```

## 8.2 Submission states

```text
draft
submitted
testing
needs_revision
passed
```

## 8.3 Test run states

```text
queued
preparing
running_public
running_hidden
finalizing
passed
failed
infrastructure_error
```

## 8.4 Experiment states

```text
draft
locked
awaiting_run
running
complete
interpreted
failed
```

## 8.5 Journal entry states

```text
draft
complete
needs_interpretation
linked_to_mastery
```

## 8.6 Mastery gate states

```text
not_ready
ready
evaluating
needs_evidence
mastered
```

---

# 9. Screen A — Learner Dashboard

## 9.1 Purpose

Answer immediately:

- Where am I?
- What should I do next?
- What evidence is waiting for me?
- What is my current compute context?

## 9.2 Desktop wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ FPLLM    Phase 1 · Build        Search ⌘K        8 GB · FP16     Sync ✓     │
├───────────────┬─────────────────────────────────────────────┬────────────────┤
│ Home ●        │                                             │ CURRENT        │
│ Learn         │  Continue                                   │ OBJECTIVE      │
│ Lab           │  ┌───────────────────────────────────────┐  │               │
│ Research      │  │ Phase 1 · Causal Attention           │  │ Measure        │
│ Progress      │  │ State: EXPERIMENTING                 │  │ attention      │
│               │  │                                       │  │ memory scaling│
│               │  │ Next: run S={128,256,512,1024}       │  │               │
│               │  │                         [Resume]       │  │ PROFILE       │
│               │  └───────────────────────────────────────┘  │ 8 GB Minimum  │
│               │                                             │ FP16 + scaler │
│               │  Mastery                                    │               │
│               │  Concepts        ████████░░ 80%             │ COMMIT        │
│               │  Implementation  ██████████ 100%            │ 7bc81ea       │
│               │  Experiment      ███░░░░░░░ 30%             │               │
│               │  Interpretation  ░░░░░░░░░░ 0%              │               │
│               │                                             │               │
│               │  Latest evidence                            │               │
│               │  E-014 · draft                              │               │
│               │  Prediction locked ✓                        │               │
│               │                                             │               │
│               │  Research                                   │               │
│               │  1 entry needs interpretation               │               │
├───────────────┴─────────────────────────────────────────────┴────────────────┤
│ Course v1.0 · Unit v1.0 · Lab v1.0 · Repository connected                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 9.3 Primary action

`Resume`

Behavior:

- `learning` → Learning Unit;
- `implementing` → Lab;
- `experimenting` → Experiment;
- `awaiting_mastery` → Mastery detail.

The button label should become explicit when possible:

```text
Resume lesson
Resume lab
Run experiment
Complete interpretation
```

## 9.4 Dashboard card order

1. Continue
2. Mastery snapshot
3. Latest evidence
4. Research work
5. Optional phase overview

No news or recommendation feed.

---

# 10. Screen B — Course Map

## 10.1 Purpose

Represent prerequisite structure, not just chronology.

## 10.2 Desktop wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Phase 1 — Build                                      [List] [Dependency map]│
├───────────────┬─────────────────────────────────────────────┬────────────────┤
│ Phase 0 ✓     │                                             │ PHASE STATUS   │
│ Phase 1 ●     │     Text & Bytes ✓                          │               │
│ Phase 2       │          │                                  │ 5 / 16 units  │
│ Phase 3       │          ▼                                  │ mastered      │
│ ...           │       BPE ✓                                 │               │
│               │          │                                  │ Current       │
│               │          ▼                                  │ Attention     │
│               │   LM Objective ✓                            │               │
│               │          │                                  │               │
│               │          ▼                                  │               │
│               │   Attention ●────────► RoPE ○               │               │
│               │        │              │                      │               │
│               │        └──────► GQA ○ ◄─────┘               │               │
│               │                    │                         │               │
│               │                    ▼                         │               │
│               │                 Decoder ◌                    │               │
│               │                    │                         │               │
│               │                    ▼                         │               │
│               │                 Trainer ◌                    │               │
└───────────────┴─────────────────────────────────────────────┴────────────────┘
```

Legend:

```text
✓ mastered
● current
○ available
◌ prerequisite incomplete
```

## 10.3 Node interaction

Selecting a node opens detail:

```text
Causal Attention
State: Experimenting

Prerequisites
✓ LM Objective

Mastery evidence
✓ concept check
✓ implementation
✓ public tests
✓ hidden tests
○ memory experiment
○ interpretation

[Open unit]
```

## 10.4 Read-ahead policy

A downstream node with unmet prerequisites may still expose:

`Read concept`

but not:

`Start required lab`

---

# 11. Screen C — Learning Unit: Causal Attention

## 11.1 Purpose

Teach the concept while connecting formalism to tensor mechanics and implementation.

## 11.2 Section rail

```text
1  Intuition
2  Formalism
3  Tensor shapes
4  Causal masking
5  GQA mechanics
6  Implementation bridge
7  Failure modes
8  Lab
9  Experiment
10 Mastery
```

## 11.3 Header

```text
Phase 1 · Build
Causal Grouped-Query Attention

Objective
Implement causal GQA from raw tensor operations and verify causal correctness.

Estimated active time
3–4 h

Prerequisites
✓ LM objective
✓ matrix multiplication
```

## 11.4 Learning content layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Section rail    │ Main content                                  │ Context   │
├─────────────────┼───────────────────────────────────────────────┼───────────┤
│ ● Intuition     │ Why attention?                                │ Objective │
│ ○ Formalism     │                                               │           │
│ ○ Shapes        │ explanatory prose                             │ Mastery   │
│ ○ Masking       │                                               │ 4 / 6     │
│ ○ GQA           │      [diagram]                                │           │
│ ○ Implement     │                                               │ Notes     │
│ ○ Failures      │ Equation                                      │           │
│ ○ Lab           │                                               │           │
│ ○ Experiment    │ [Show shapes] [Numerical] [Implementation]    │           │
│ ○ Mastery       │                                               │           │
└─────────────────┴───────────────────────────────────────────────┴───────────┘
```

## 11.5 Equation interaction

Example:

\[
A=\operatorname{softmax}
\left(
\frac{QK^\top}{\sqrt{d_h}}+M
\right)
\]

Controls:

```text
[Show shapes]
[Show numerical example]
[Show implementation]
```

### Show shapes

```text
Q      [B, Hq,  S, Dh] = [B, 12, S, 64]
K      [B, Hkv, S, Dh] = [B,  4, S, 64]
V      [B, Hkv, S, Dh] = [B,  4, S, 64]

Grouped Q
       [B, Hkv, G, S, Dh] = [B, 4, 3, S, 64]

Scores
       [B, Hkv, G, S, S]
```

### Show numerical example

Use a tiny 4-token example and explicitly show future-mask positions.

### Show implementation

```python
scores = torch.matmul(q, k.transpose(-2, -1))
scores *= head_dim ** -0.5
scores = scores.masked_fill(causal_mask, float("-inf"))
probs = torch.softmax(scores.float(), dim=-1).to(q.dtype)
```

The implementation view must not expose assignment-complete code if that would defeat the lab.

## 11.6 Concept check

Before the memory experiment:

> If sequence length doubles and the attention-score tensor dominates memory, what scaling do you predict for that tensor?

Options:

```text
2×
4×
8×
No fixed relationship
```

The response may seed the later experiment prediction.

## 11.7 Lab transition

```text
You now have enough conceptual machinery to implement the module.

[Open Lab]
```

Opening the lab does not mark the lesson complete.

---

# 12. Screen D — Lab Workspace

## 12.1 Purpose

Make the implementation contract unambiguous.

## 12.2 Header

```text
A2 — Causal Grouped-Query Attention

State
IMPLEMENTING

Course profile
8 GB Minimum

Repository
yourname/fpllm

Current branch
phase1-attention

Current observed commit
7bc81ea
```

## 12.3 Desktop wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ A2 · Causal GQA                                      State: IMPLEMENTING     │
├───────────────┬─────────────────────────────────────────────┬────────────────┤
│ Lab sections  │ REQUIREMENTS                                │ CONTEXT        │
│               │                                             │                │
│ ● Requirements│ □ 12 query heads                            │ Objective      │
│ ○ Interface   │ □ 4 KV heads                               │ Causal GQA     │
│ ○ Constraints │ □ no permanent KV duplication              │                │
│ ○ Commands    │ □ FP32 softmax                             │ Hardware       │
│ ○ Tests       │ □ causal mask                              │ 8 GB Minimum   │
│ ○ Experiment  │ □ output [B,S,768]                         │                │
│ ○ Submit      │ □ gradients reach projections              │ Git            │
│               │                                             │ 7bc81ea        │
│               │ CONSTRAINTS                                 │                │
│               │ × nn.MultiheadAttention                    │                │
│               │ × scaled_dot_product_attention             │                │
│               │ × FlashAttention                           │                │
│               │                                             │                │
│               │ PUBLIC TEST COMMAND                         │                │
│               │ pytest tests/public/test_attention.py       │                │
│               │                         [Copy]               │                │
└───────────────┴─────────────────────────────────────────────┴────────────────┘
```

## 12.4 Requirement checklist behavior

The checklist is evidence-driven, not manually checked.

States:

```text
○ unverified
✓ verified by public test
✓ verified by hidden test
! failed
```

## 12.5 Interface section

```text
src/fpllm/model/attention.py

class CausalSelfAttention(nn.Module):
    def forward(
        self,
        x: torch.Tensor,
        positions: torch.Tensor | None = None,
    ) -> torch.Tensor:
        ...
```

## 12.6 Constraint section

Explain why excluded abstractions are disallowed.

Example:

> `scaled_dot_product_attention` is prohibited because the objective is to construct and inspect the score/mask/softmax path directly. It becomes a comparison target later.

## 12.7 Command block

```text
pytest tests/public/test_attention.py
```

Actions:

```text
Copy
View test source
```

No browser execution for MVP.

## 12.8 Submission card

```text
Submit implementation

Repository
yourname/fpllm

Branch
phase1-attention

Commit
7bc81ea

Detected
2 minutes ago

[Submit this commit]
```

Confirmation:

```text
Submit commit 7bc81ea?

This commit becomes the immutable identity of the attempt.
Later commits will not alter this submission.

[Cancel]
[Submit]
```

---

# 13. Screen E — Submission / Test Run

## 13.1 Loading state

Use a stepper:

```text
Qualification run

✓ Repository snapshot acquired
✓ Environment prepared
✓ Public tests complete
→ Hidden numerical tests
○ Hidden causality tests
○ Hidden memory-structure tests
○ Finalizing report
```

## 13.2 Passing state

```text
A2 — Causal Attention
Submission 7bc81ea

Public tests
12 / 12 PASS

Hidden tests
6 / 6 PASS

Implementation gate
PASSED

Next required evidence
Attention memory-scaling experiment

[Start experiment]
```

## 13.3 Failing state

```text
A2 — Causal Attention
Submission 7bc81ea

Public tests
12 / 12 PASS

Hidden tests
5 / 6 PASS

Overall
NEEDS REVISION
```

Failure card:

```text
Hidden invariant failed
KV memory structure

Invariant
Grouped-query attention must not permanently materialize repeated K/V heads.

Observed
Intermediate allocation is consistent with 12 KV heads.

Relevant concept
GQA → shared key/value heads

[Review concept]
[Get diagnostic hint]
```

## 13.4 Assistance ladder

1. invariant;
2. diagnostic question;
3. conceptual hint;
4. analogous example;
5. deeper help on explicit request.

Diagnostic question example:

> At what point in your implementation do four KV heads become twelve tensors in memory?

Conceptual hint example:

> Reshape query heads into `[Hkv, G]` groups and use broadcasting semantics instead of constructing repeated K/V storage.

---

# 14. Screen F — Experiment Setup

## 14.1 Entry condition

Implementation gate passed.

## 14.2 Experiment identity

```text
Experiment
E-014

Title
Attention Memory Scaling

Linked submission
7bc81ea
```

## 14.3 Required fields

Before lock:

```text
Question
predefined, read-only

Hypothesis
learner-authored

Prediction
learner-authored

Independent variable
sequence length — predefined

Controlled variables
model / batch / precision / implementation commit

Sequence lengths
128, 256, 512, 1024
```

## 14.4 Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ E-014 · Attention Memory Scaling                         State: DRAFT        │
├───────────────┬─────────────────────────────────────────────┬────────────────┤
│ Setup         │ QUESTION                                    │ PROVENANCE     │
│ ● Hypothesis  │ How does naïve attention memory scale       │                │
│ ○ Variables   │ with sequence length?                       │ Commit         │
│ ○ Lock        │                                             │ 7bc81ea        │
│ ○ Run         │ HYPOTHESIS                                  │                │
│               │ [ textarea                               ]  │ Profile        │
│               │                                             │ 8 GB Minimum   │
│               │ PREDICTION                                  │                │
│               │ [ textarea                               ]  │ Precision      │
│               │                                             │ FP16           │
│               │ VARIABLES                                   │                │
│               │ S = 128,256,512,1024                        │                │
│               │                                             │                │
│               │                          [Lock experiment]   │                │
└───────────────┴─────────────────────────────────────────────┴────────────────┘
```

## 14.5 Lock behavior

Before lock:

- hypothesis editable;
- prediction editable;
- variables editable only where course allows.

After lock:

- hypothesis/prediction immutable for that experiment;
- edits require a new experiment revision/ID.

Confirmation:

```text
Lock experiment?

Your hypothesis and prediction will be preserved as pre-run evidence.
You can create a new experiment later, but you cannot rewrite this prediction
after measurements are imported.

[Cancel]
[Lock]
```

---

# 15. Screen G — Experiment Run

## 15.1 Run instructions

```text
Run locally

PYTHONPATH=src python scripts/memory_probe.py \
  --experiment E-014

[Copy command]
```

The exact command may later use an authenticated CLI.

## 15.2 MVP artifact import

```text
[Import result JSON]
```

Artifact must include:

- experiment ID;
- commit;
- profile;
- sequence lengths;
- peak allocated/reserved memory;
- throughput;
- environment identity.

## 15.3 Commit mismatch

```text
Artifact does not match this experiment

Expected commit
7bc81ea

Artifact commit
31e88f4

This result cannot be attached as evidence for E-014.

[Create new experiment from artifact]
[Choose another file]
```

No silent coercion.

## 15.4 Partial result

```text
Partial experiment

✓ S=128
✓ S=256
✓ S=512
! S=1024 — CUDA OOM

[Inspect failure]
[Retry S=1024]
[Complete as partial]
```

A partial run may remain valid scientific evidence.

---

# 16. Screen H — Experiment Results

## 16.1 Information order

1. Prediction
2. Measurement
3. Interpretation
4. Conclusion
5. Provenance

## 16.2 Desktop wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ E-014 · Attention Memory Scaling                       State: COMPLETE       │
├───────────────┬─────────────────────────────────────────────┬────────────────┤
│ Results       │ PREDICTION                                  │ EVIDENCE       │
│ ● Overview    │ "Doubling S should approach 4×..."          │                │
│ ○ Table       │                                             │ Commit         │
│ ○ Chart       │ MEASUREMENT                                 │ 7bc81ea        │
│ ○ Interpret   │                                             │                │
│ ○ Provenance  │ [VRAM vs sequence-length chart]             │ GPU            │
│               │                                             │ RTX 3070       │
│               │                                             │                │
│               │ S      Peak VRAM      Tokens/s              │ Run            │
│               │ 128    ...            ...                   │ E-014-R1       │
│               │ 256    ...            ...                   │                │
│               │ 512    ...            ...                   │                │
│               │ 1024   ...            ...                   │                │
│               │                                             │                │
│               │ INTERPRETATION                              │                │
│               │ [ Write what the data implies...        ]  │                │
└───────────────┴─────────────────────────────────────────────┴────────────────┘
```

## 16.3 Charts

Primary chart:

```text
x-axis: sequence length S
y-axis: peak reserved VRAM
```

Secondary chart:

```text
x-axis: sequence length S
y-axis: tokens/sec
```

Do not use a dual-axis chart for these two metrics.

Every chart must have an accessible data table.

## 16.4 Interpretation prompts

Required:

1. What trend do you observe?
2. Does the result support your prediction?
3. Why might doubling \(S\) not produce exactly \(4\times\) total VRAM?
4. Which memory terms are not quadratic in \(S\)?
5. What uncertainty or runtime effects limit the conclusion?

## 16.5 Conclusion selector

```text
○ Supports
○ Partially supports
○ Does not support
○ Inconclusive
```

Never “Proven.”

## 16.6 Completion

Draft interpretation autosaves.

Final action:

```text
[Complete interpretation]
```

---

# 17. Screen I — Mastery Detail

## 17.1 Mastery matrix

```text
Causal Attention Mastery

✓ Conceptual understanding
✓ Required implementation
✓ Public tests
✓ Hidden correctness tests
✓ Memory experiment
✓ Interpretation

MASTERED
```

Before completion, missing evidence remains explicit.

## 17.2 Evidence links

```text
Hidden correctness tests
Passed in submission S-009 · commit 7bc81ea

Memory experiment
E-014 · complete

Interpretation
Journal entry J-018
```

Mastery is therefore auditable.

## 17.3 Completion transition

```text
Causal Attention
MASTERED

Evidence package
[View]

Next available capability
RoPE

[Continue]
```

---

# 18. Screen J — Research Journal

## 18.1 Timeline

```text
Research Journal

Sep 18

E-014  Attention memory scaling
       Interpretation complete ✓

Q-007  Why does allocator reservation exceed allocation?
       Open question

Sep 17

S-009  Causal attention implementation
       Passed hidden tests
```

## 18.2 Journal entry detail

```text
E-014 · Attention Memory Scaling

QUESTION
auto-linked

HYPOTHESIS
locked pre-run text

PREDICTION
locked pre-run text

CONFIGURATION
auto-populated

OBSERVATION
learner-authored

RESULT
auto-linked measurement

INTERPRETATION
versioned learner-authored text

FAILURE / UNCERTAINTY
learner-authored

NEXT EXPERIMENT
learner-authored
```

Machine evidence and learner analysis should use distinguishable treatments.

---

# 19. Screen K — Progress

## 19.1 Phase-level view

```text
Phase 1 — Build

Concepts          82%
Implementation    71%
Experiments       54%
Mastery           46%
Research journal  63%
```

## 19.2 Capability matrix

```text
Capability      Learn   Implement   Test   Experiment   Explain   Mastery
Tokenizer       ✓       ✓           ✓      ✓            ✓         ✓
Attention       ✓       ✓           ✓      ✓            ✓         ✓
RoPE            ✓       —           —      —            —         —
GQA             ✓       partial     —      —            —         —
Decoder         available after prerequisites
```

The aggregate percentage is not the primary status.

---

# 20. Technical onboarding interaction contract

## 20.1 Sequence

```text
Account
→ Track
→ GitHub/repository
→ Environment probe
→ Compute profile
→ Qualification
→ Dashboard
```

## 20.2 Compute result

```text
Environment check

Python             ✓ 3.12
PyTorch            ✓
CUDA               ✓
GPU                RTX 3070
VRAM               8.0 GB
BF16               unavailable
FP16               available
Git                ✓
Repository         ✓

Recommended profile
8 GB Minimum

precision          FP16 + GradScaler
microbatch         2
accumulation       32
checkpointing      enabled

[Use recommended profile]
[Configure manually]
```

## 20.3 No-CUDA result

```text
CUDA GPU not detected.

You can continue with CPU-compatible setup and early material.
Selected systems laboratories later require temporary NVIDIA CUDA access.

[Continue locally]
[View compute options]
```

---

# 21. Button hierarchy

## Primary

One dominant next action per major screen:

```text
Resume
Open Lab
Submit this commit
Start experiment
Lock experiment
Import result
Complete interpretation
Continue
```

## Secondary

```text
Review concept
View provenance
Configure manually
View test source
```

## Tertiary/text

```text
Copy
Open repository
View details
```

Avoid visually competing primary actions.

---

# 22. Form behavior

## 22.1 Autosave

Autosave:

- hypothesis drafts;
- prediction drafts;
- interpretation drafts;
- journal notes.

Show state:

```text
Saved
Saving…
Offline — saved locally
Sync failed
```

## 22.2 Validation

Validation appears near the field and in a summary only if needed.

Never erase learner text on failure.

## 22.3 Locked scientific fields

Locked fields display:

```text
Locked before run · Sep 18 09:42
```

and cannot be edited within that experiment instance.

---

# 23. Loading states

Long-running operations expose stages.

Example:

```text
Hidden qualification

✓ Snapshot acquired
✓ Environment prepared
→ Numerical equivalence
○ Causal invariants
○ Memory structure
○ Final report
```

Do not fake percentages when duration is unknown.

---

# 24. Error state contract

Every significant error contains:

1. What failed
2. Evidence
3. Likely diagnostic area
4. Next action

Example:

```text
CUDA OOM at S=1024

Observed
Peak reserved VRAM reached available capacity.

Your profile
8 GB Minimum

Expected experiment config
batch=1
checkpointing=on

[Review memory configuration]
[Retry]
```

---

# 25. Offline/local-first states

## 25.1 Browser offline

```text
Offline
Drafts will be stored locally and synchronized when connection returns.
```

## 25.2 Later artifact sync

Future CLI path may expose:

```text
3 local artifacts available to import

E-014 result
qualification report
environment probe

[Review imports]
```

MVP may use manual import instead.

---

# 26. Notifications

Allow only meaningful operational notifications in MVP:

- hidden tests complete;
- experiment artifact imported;
- reviewer feedback;
- mastery granted;
- proposal needs revision.

No streak or re-engagement pressure.

---

# 27. Search and command palette

## 27.1 Command palette examples

```text
Go to Causal Attention
Open current lab
Start memory experiment
Open E-014
New journal note
View compute profile
Open repository
```

## 27.2 Search result categories

```text
Learning Units
Experiments
Journal
Readings
Code references
```

The prototype only requires learning units, experiments, journal, and code-reference links.

---

# 28. Accessibility interaction contract

The prototype must support:

- complete keyboard navigation;
- visible focus;
- semantic heading order;
- active-navigation semantics;
- descriptive button labels;
- tables for chart data;
- no color-only pass/fail state;
- screen-readable status text;
- accessible math fallback where supported;
- code blocks without keyboard traps;
- reduced motion;
- 200% text zoom without loss of core functionality.

Charts require a table alternative immediately available.

---

# 29. Visual-state semantics

Exact colors are not frozen here, but semantic roles are.

```text
neutral       information / inactive
positive      verified / passed / mastered
warning       attention / incomplete / partial
negative      failed / invalid
research      hypothesis / experiment identity
```

Every state also receives text and non-color signaling.

---

# 30. Typography/content-density principles

The interface should prioritize:

- readable long-form technical prose;
- compact operational metadata;
- highly legible code;
- clear equations;
- dense tables when justified.

Do not inflate cards and whitespace merely to imitate generic SaaS dashboards.

---

# 31. Mobile wireframes

## 31.1 Mobile Learning Unit

```text
┌──────────────────────────────┐
│ ← Phase 1        8 GB · FP16 │
├──────────────────────────────┤
│ Causal Attention             │
│                              │
│ Objective                    │
│ Implement causal GQA...      │
│                              │
│ [Section 3 of 10 ▼]          │
│                              │
│ Tensor Shapes                │
│                              │
│ equation                     │
│                              │
│ [Show shapes]                │
│ [Numerical example]          │
│ [Implementation]             │
│                              │
│ content...                   │
├──────────────────────────────┤
│ Home Learn Lab Research Prog │
└──────────────────────────────┘
```

## 31.2 Mobile Lab

```text
┌──────────────────────────────┐
│ Causal Attention Lab         │
├──────────────────────────────┤
│ Desktop development advised  │
│                              │
│ Requirements                 │
│ □ 12 query heads             │
│ □ 4 KV heads                │
│ ...                          │
│                              │
│ Public test command          │
│ pytest ...                   │
│ [Copy]                       │
│                              │
│ Submission                   │
│ Commit 7bc81ea               │
│ [Submit]                     │
└──────────────────────────────┘
```

No in-browser code editor.

## 31.3 Mobile experiment result

Use stacked chart → table → interpretation.

---

# 32. Tablet wireframe

```text
┌──────────────────────────────────────────────────────────┐
│ Top bar                                                  │
├────────┬─────────────────────────────────────────────────┤
│ Nav    │ Main workspace                                  │
│ rail   │                                                 │
│        │                                                 │
│        │                                                 │
│        │                                                 │
└────────┴─────────────────────────────────────────────────┘
```

Context panel opens as a right-side drawer.

---

# 33. Prototype data requirements

These are UX contracts, not final backend schemas.

## 33.1 Learner

```json
{
  "id": "u_123",
  "track": "research_engineer",
  "currentUnitId": "p1_attention"
}
```

## 33.2 Compute profile

```json
{
  "detectedGpu": "NVIDIA RTX 3070",
  "vramGiB": 8,
  "bf16Supported": false,
  "cudaAvailable": true,
  "selectedProfile": "8gb",
  "precision": "fp16",
  "gradScaler": true
}
```

## 33.3 Learning unit

```json
{
  "id": "p1_attention",
  "phase": 1,
  "title": "Causal Grouped-Query Attention",
  "state": "experimenting",
  "version": "1.0"
}
```

## 33.4 Submission

```json
{
  "id": "sub_009",
  "repository": "yourname/fpllm",
  "branch": "phase1-attention",
  "commit": "7bc81ea",
  "labVersion": "1.0",
  "state": "passed"
}
```

## 33.5 Test run

```json
{
  "id": "tr_010",
  "submissionId": "sub_009",
  "public": {"passed": 12, "total": 12},
  "hidden": {"passed": 6, "total": 6},
  "state": "passed"
}
```

## 33.6 Experiment

```json
{
  "id": "E-014",
  "type": "attention_memory_scaling",
  "state": "complete",
  "submissionId": "sub_009",
  "commit": "7bc81ea",
  "sequenceLengths": [128, 256, 512, 1024]
}
```

## 33.7 Mastery

```json
{
  "unitId": "p1_attention",
  "conceptual": "passed",
  "implementation": "passed",
  "publicTests": "passed",
  "hiddenTests": "passed",
  "experiment": "passed",
  "interpretation": "pending",
  "overall": "awaiting_mastery"
}
```

---

# 34. Analytics events worth instrumenting

Useful product events:

```text
unit_opened
concept_check_submitted
lab_opened
test_command_copied
submission_created
test_run_completed
failure_hint_opened
experiment_created
experiment_locked
artifact_imported
interpretation_completed
mastery_granted
journal_entry_opened
```

Do not make page dwell time a primary learning metric.

---

# 35. Prototype acceptance tests

The implementation is not ready for learner testing unless all of the following are true.

## Navigation

- learner can move Dashboard → Unit → Lab → Results → Experiment → Mastery → Journal;
- browser back/forward maintains coherent state;
- current navigation is always clear.

## Learning unit

- equations render;
- shape/implementation expansions work;
- section navigation is keyboard accessible;
- concept-check result is preserved.

## Lab

- requirements are clear;
- commit identity is visible;
- submission confirmation explains immutability.

## Test result

- public/hidden separation is clear;
- hidden failure points to a documented invariant;
- assistance ladder reveals progressively.

## Experiment

- hypothesis/prediction can be drafted;
- lock is irreversible for the experiment instance;
- artifact commit mismatch is blocked;
- results table and chart render;
- interpretation can be completed.

## Mastery

- every mastery dimension links to evidence;
- “Mastered” cannot occur with missing evidence.

## Research

- completed experiment generates/links a journal entry;
- machine evidence and learner analysis are visually distinguishable.

## Responsive/accessibility

- learning page works at mobile width;
- lab remains legible on mobile;
- charts expose table data;
- full keyboard route is possible.

---

# 36. Beta usability protocol

The first beta should test the vertical slice with technically capable learners.

The learner is given only:

- course account;
- repository setup instructions;
- a brief explanation of the course premise.

The facilitator should not explain platform navigation unless the learner is genuinely blocked.

Observe whether the learner can independently:

1. identify the objective;
2. locate the relevant formalism;
3. understand implementation requirements;
4. run the public test command;
5. submit the intended commit;
6. interpret a hidden-test failure;
7. start and lock the experiment;
8. import results;
9. interpret chart/table evidence;
10. understand mastery status.

Record friction by category:

```text
navigation
terminology
technical setup
content comprehension
lab contract
test feedback
experiment workflow
mastery transparency
```

---

# 37. UX success measures

Evaluate the prototype using:

- percentage of learners who identify the next required action without help;
- percentage who submit the intended commit correctly;
- percentage who understand why a hidden test failed;
- percentage who complete prediction before measurement;
- percentage who correctly import matching evidence;
- percentage who can state why mastery was/was not granted;
- number of platform-navigation interventions required by facilitator.

Do not make time-on-site a primary success measure.

---

# 38. Explicitly deferred interaction work

Not part of this specification:

- browser IDE;
- live multi-user collaboration;
- social feed;
- discussion forum;
- managed GPU scheduling;
- marketplace;
- payment flows;
- full instructor console;
- full academic paper editor;
- AI tutor embedded everywhere;
- real-time cloud terminal;
- peer review marketplace.

---

# 39. Open implementation decisions

These remain open and must not be accidentally frozen by frontend work:

1. frontend framework;
2. backend/API framework;
3. database;
4. authentication provider;
5. GitHub integration mechanism;
6. job-runner architecture for hidden tests;
7. artifact-storage provider;
8. analytics stack;
9. deployment provider;
10. exact visual design tokens;
11. hosted-compute provider;
12. reviewer/instructor product scope.

---

# 40. Recommended implementation sequence

1. static global shell;
2. dashboard with mock learner state;
3. Causal Attention Learning Unit;
4. Lab workspace;
5. mock submission/test-result flow;
6. experiment draft/lock/result flow;
7. mastery detail;
8. journal linkage;
9. responsive behavior;
10. accessibility pass;
11. integration with real repository/test/artifact services.

The first milestone is not “all pages exist.”

It is:

\[
\boxed{
\text{one complete evidence-producing learning loop works end to end}
}
\]

---

# 41. First prototype completion definition

The Causal Attention vertical slice is complete when a beta learner can:

\[
\text{learn}
\rightarrow
\text{implement locally}
\rightarrow
\text{submit commit}
\rightarrow
\text{receive test evidence}
\rightarrow
\text{run experiment}
\rightarrow
\text{interpret result}
\rightarrow
\text{earn mastery}
\]

without the platform obscuring:

- what the learner is doing;
- why they are doing it;
- what evidence was produced;
- what remains incomplete.

---

# 42. Relationship to the project decision register

This document does not replace the Consolidated Decision Register.

The register remains the authoritative source for project-wide decisions.

This specification is a lower-level design document that operationalizes the already-frozen platform decisions for the first vertical slice.

If a conflict is discovered:

1. the Consolidated Decision Register controls;
2. this document must be revised;
3. implementation must not silently redefine the product constraint.

---

**End of Interaction & Wireframe Specification v1.0**
