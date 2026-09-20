# Platform v0.5 — Maintainer Corrections Round 6 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Codex review baseline:** `23a160f8c94cfd83a352443f15dda6897cc129f3`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and scope

The fresh Codex review of exact HEAD `23a160f8...` found two remaining trust-boundary specification gaps:

1. round 4 left a conditional exception under which the evaluator-base builder could potentially receive final hidden-evaluator image-content read actions; because that builder has ordinary outbound dependency access, such content authority would recreate an exfiltration path;
2. round 5 allowed the trusted approver to create the shared DynamoDB candidate item directly, which does not server-enforce the required initial component states/null protected digests even if the write uses a conditional expression.

Both findings are accepted. This delta removes the final-image read exception and inserts a protected schema-enforcing candidate-admission mediator.

Precedence inside the P0 provider/operations record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R6_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R5_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R4_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R3_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Evaluator-base builder has zero final-evaluator repository authority

Round 4 §3 is superseded where it allowed a separately justified final-image digest-existence read.

The protected evaluator-base builder has **no ECR API authority at all** on:

```text
fpllm/hidden-evaluator
```

This includes, without limitation:

```text
ecr:BatchGetImage
ecr:GetDownloadUrlForLayer
ecr:BatchCheckLayerAvailability
ecr:DescribeImages
ecr:ListImages
ecr:PutImage
all layer-upload actions
repository/lifecycle/policy administration
```

The evaluator-base builder requires no final-image existence check. Its authoritative output is only its own successfully pushed `fpllm/hidden-evaluator-base@sha256:...` digest recorded through the protected broker/candidate state.

The final hidden-evaluator repository remains readable only by the already-frozen protected principals that need image content:

```text
hidden-evaluator CodeBuild role  # push + required verification read
production worker instance role  # pull only
```

and by no evaluator-base-builder, worker-builder, GitHub OIDC/deploy, web, test-runtime, or learner/evaluator-container principal.

P1 must include a negative authorization test proving the evaluator-base-builder role receives `AccessDenied` for both `BatchGetImage` and `GetDownloadUrlForLayer` on `fpllm/hidden-evaluator` while retaining its required authority on `fpllm/hidden-evaluator-base`.

---

# 2. Candidate creation is mediated by a protected admission function

Round 5 §2.2 is superseded where it grants the sensitive-release approver direct DynamoDB candidate-write authority.

Add a second protected AWS Lambda dedicated to candidate admission:

```text
function:              fpllm-beta-sensitive-release-admit
region:                eu-west-1
reserved concurrency:  1
timeout:                <= 30 seconds
public Function URL:    disabled
```

This function belongs to the protected execution/sensitive-release stack and is distinct from the execution-release broker.

## 2.1 Approver authority

The federated role:

```text
fpllm-beta-sensitive-release-approver
```

may invoke only the exact admission-function ARN after independently verifying the reviewed execution context and private evaluator object.

It receives:

```text
no dynamodb:PutItem
no dynamodb:UpdateItem
no dynamodb:TransactWriteItems
no direct write/reset permission on fpllm-beta-sensitive-release
no execution-broker invocation authority unless separately required and explicitly frozen
```

It may retain narrowly scoped candidate `GetItem`/audit read authority after admission if required for verification, but cannot mutate candidate or broker-owned state.

GitHub OIDC/deploy roles cannot invoke the admission function.

## 2.2 Admission request schema

The approver supplies only the verified immutable candidate inputs:

```text
platform source SHA
execution-source-context bucket/key/version + SHA-256 + byte size
private evaluator bucket/key/version + committed SHA-256 + byte size
testBundleId
private evaluator version
bounded approval note/reference where required for audit
```

Maximum decoded request body: **16 KiB**. Unknown fields are rejected. The caller cannot supply:

```text
approvalId
component states
buildStartCount values
active build IDs
workerDigest
evaluatorBaseDigest
hiddenEvaluatorDigest
overall state
promotion state
CodeBuild project identity
broker idempotency fields
```

The function derives the authenticated federated actor from AWS request/audit context rather than accepting an authoritative caller-supplied actor string.

## 2.3 Server-enforced initial state

The admission function generates a new immutable `approvalId` and writes the complete candidate using an atomic conditional operation that rejects an existing identity and initializes protected fields exactly as follows:

```text
worker state = approved
worker buildStartCount = 0
worker activeBuildId = null
workerDigest = null

evaluator-base state = approved
evaluator-base buildStartCount = 0
evaluator-base activeBuildId = null
evaluatorBaseDigest = null

hidden-evaluator state = blocked_on_base
hidden-evaluator buildStartCount = 0
hidden-evaluator activeBuildId = null
hiddenEvaluatorDigest = null

overall state = approved
promotion state = not_promoted
```

No approver-provided request value may override these fields.

The function records the approval timestamp and authenticated approver audit identity server-side.

## 2.4 Admission-function role

The admission Lambda execution role may:

- create a new candidate item using the bounded initial schema;
- perform only the conditional/transactional writes needed to guarantee unique approval identity and one coherent initial record;
- write bounded structured logs/metrics without private evaluator contents.

It may not:

```text
start/retry/update CodeBuild
write protected output digests after creation
push/pull protected ECR image content
read/decrypt private evaluator objects
mutate worker infrastructure
apply protected CloudFormation stacks
invoke the execution-release broker
```

The execution-release broker remains the only service principal allowed to mutate component build state/counters/active build IDs and to record protected output digests after reconciling protected CodeBuild results.

---

# 3. Candidate ownership is field- and phase-separated

The candidate lifecycle now has three non-overlapping write phases:

```text
candidate admission function:
  creates immutable verified inputs + exact initial state

execution-release broker:
  mutates build state/counters/build IDs
  records protected component digests
  derives overall built/failed state

protected promotion path:
  consumes built candidate identity/digests
  records promotion disposition only after protected infrastructure mutation
```

The human approver never writes broker-owned build fields. The broker never rewrites immutable source/private input identity. The protected deployment operator cannot substitute build digests.

P1 may realize this in one DynamoDB item or multiple transactionally linked items, but effective IAM/application authorization must preserve these ownership boundaries. A single shared table does not imply shared write authority.

---

# 4. Promotion admission re-validates canonical state

Before worker/evaluator promotion, the protected promotion path must read the canonical protected candidate record by `approvalId` and verify:

```text
overall state == built
promotion state == not_promoted
workerDigest != null
evaluatorBaseDigest != null
hiddenEvaluatorDigest != null
all three outputs bind to the same approvalId/platform source SHA
```

The caller does not supply authoritative digest values. Any digest values present in an operator command/request are treated only as optional expected-value assertions and must exactly match canonical state before mutation.

Successful promotion conditionally transitions the promotion state so replay cannot apply a different digest pair under the same approval.

---

# 5. Required P1 evidence additions

In addition to all non-conflicting prior evidence requirements, P1 must retain proof that:

1. the evaluator-base-builder role cannot read any image content from `fpllm/hidden-evaluator`;
2. the approver has no direct DynamoDB candidate-write authority;
3. only the exact approver role can invoke `fpllm-beta-sensitive-release-admit`, and GitHub OIDC cannot invoke it;
4. unknown fields, output-digest fields, state fields, caller-supplied approval IDs, and oversized requests are rejected by candidate admission;
5. a newly admitted candidate always has the exact server-generated initial state/null digest values frozen in §2.3;
6. duplicate/replayed admission cannot overwrite an existing candidate;
7. the admission-function role cannot start builds or mutate post-admission build/digest state;
8. the execution broker cannot rewrite immutable candidate input identity;
9. the protected promotion path reads canonical candidate state and rejects arbitrary/non-recorded digest substitution;
10. CloudTrail/audit evidence identifies approver invocation, server-generated approval identity, broker transitions, and protected promotion separately.

---

# 6. Review-state boundary

This delta closes both actionable findings from the fresh Codex review of exact HEAD `23a160f8...` at the decision/specification level. It does not claim the admission Lambda, IAM denies, DynamoDB ownership separation, final-ECR deny tests, or production resources are implemented.

The merge gate restarts from the resulting exact HEAD:

```text
CI/affected gates
-> fresh exhaustive maintainer exact-HEAD review
-> fix/repeat if needed
-> fresh exact-HEAD Codex review
-> disposition all actionable threads
-> final exact-HEAD CI/review/thread check
-> squash merge
```
