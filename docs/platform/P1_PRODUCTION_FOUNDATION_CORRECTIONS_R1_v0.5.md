# Platform v0.5 — P1 Production Foundation Correction R1

**Status:** AUTHORITATIVE P1 CORRECTION DELTA / PRE-PROVISION ADMISSION TOOLING ONLY  
**Date:** 2026-09-21  
**Applies to:** `P1_PRODUCTION_FOUNDATION_v0.5.md` §4.1 and related compute-admission wording  
**P0 baseline:** `fc46a2843ac79cef23b82b08cc08dba5a1a1b095`

---

## 0. Authority and finding

This correction closes P1A-18: two immediately identical direct EC2/ECS inventory reads are not, by themselves, proof of current compute-quota state because the AWS control planes are eventually consistent.

Where this file conflicts with `P1_PRODUCTION_FOUNDATION_v0.5.md`, this correction governs the P1 live compute-admission protocol. Non-conflicting P1 and P0 decisions remain in force.

AWS documents that EC2 resource changes may not be immediately visible to subsequent `Describe` operations and specifically recommends repeated `DescribeInstances` calls with increasing waits up to a few minutes. ECS documents the same eventual-consistency model for task-affecting operations and recommends repeated `DescribeTasks` observations with backoff up to about five minutes.

Therefore the earlier rule:

```text
inventory A
-> CloudWatch reads
-> inventory B
-> accept when fingerprint(A) == fingerprint(B)
```

is insufficient for **live** admission when another authorized writer could have changed compute state immediately before collection. Both reads can return the same stale view while the newest `AWS/Usage` datapoint also predates the mutation.

Official provider basis:

- https://docs.aws.amazon.com/ec2/latest/devguide/eventual-consistency.html
- https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html
- https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html

---

## 1. Live compute admission now requires an operator-established mutation-quiescence window

The collector remains strictly read-only and therefore does **not** acquire or mint AWS mutation authority merely to create a consistency fence.

Before a live production-account admission run, the operator must place the relevant compute surfaces in a mutation-quiescent state: principals/controllers capable of starting, stopping, launching, terminating, reserving, cancelling, or otherwise changing the EC2 Standard On-Demand / On-Demand Capacity Reservation / ECS Fargate state used by this admission gate must remain idle for the complete guard and observation window.

Only after that external operational condition is established may the operator set:

```text
FPLLM_P1_COMPUTE_MUTATION_QUIESCENCE=confirmed
```

The environment value is an explicit operator assertion recorded by the controlled evidence path. It is **not** represented as a cryptographic IAM fence or as proof that AWS itself disabled all writers. Maintainer disposition of the live envelope must therefore include confirmation that the production mutation-quiescence procedure was actually in force.

If that condition cannot be established, the live admission run must not be treated as authoritative and P1 stops rather than weakening the no-create/read-only boundary.

---

## 2. Provider-convergence guard — FROZEN

For a real `AwsCli` live collection, the compute snapshot protocol is now:

```text
require operator mutation-quiescence assertion

compute inventory G0
-> wait 300 seconds
-> compute inventory A
-> Fargate AWS/Usage read
-> EC2 AWS/Usage read
-> compute inventory B
```

The fixed guard is:

```text
COMPUTE_EVENTUAL_CONSISTENCY_GUARD_SECONDS = 300
```

The live gate requires:

```text
fingerprint(G0) == fingerprint(A) == fingerprint(B)
```

If the inventory changes across the 300-second convergence guard, the collector fails closed immediately. The operator must re-establish mutation quiescence and start a new live run; the collector does not convert the failed guard into a rapid retry.

If A and B differ around the CloudWatch reads, the live collector also fails closed immediately and requires a new guard window. This prevents the old retry loop from accidentally accepting a later pair of immediate reads after a visible mutation.

The existing metric rules remain in force after the guard:

```text
effective Fargate usage
= max(fresh 15-minute AWS/Usage maximum, stable direct ECS Fargate inventory)

effective Standard EC2 usage
= max(fresh 15-minute AWS/Usage maximum, stable direct EC2 quota inventory)
```

and the frozen headroom minima remain:

```text
Fargate free headroom >= 6 vCPU
Standard On-Demand EC2 free headroom >= 4 vCPU
```

---

## 3. Evidence retained by a live accepted snapshot

An accepted live compute snapshot now records, in addition to the existing inventory and metric evidence:

```text
eventualConsistencyGuardApplied = true
eventualConsistencyGuardSeconds = 300
guardStartInventoryFingerprintSha256
inventoryFingerprintSha256
guardStartedAt
guardCompletedAt
mutationQuiescenceRequired = true
mutationQuiescenceAssertion = confirmed
mutationQuiescenceAssertionSource = FPLLM_P1_COMPUTE_MUTATION_QUIESCENCE
```

The start and final inventory fingerprints must be identical.

Fixture/unit-test collectors do not wait five minutes and do not require the operator assertion. They retain the fast retry path solely for deterministic regression testing. Fixture evidence still cannot set `liveAdmissionPassed=true` and cannot authorize production creation.

---

## 4. Scope and limitation

This correction closes the specific false-green where a provider-accepted compute mutation precedes the first direct read but both immediate direct reads and the newest metric sample can still omit it.

It does not turn a read-only report into a capacity reservation and does not claim protection against a new mutation **after** the accepted live observation. The production account must remain operationally controlled between admission evidence disposition and the subsequent provisioning step, and the provider remains the final enforcer of hard service quotas during creation.

The selected protocol intentionally combines:

```text
external writer quiescence
+ provider-recommended multi-minute convergence time
+ stable direct inventories
+ fresh historical usage metrics
+ fail-closed restart on any visible change
```

rather than pretending that two back-to-back eventually consistent reads form a linearizable snapshot.

---

## 5. Review-state boundary

This correction changes repository content and invalidates all CI and reviews from earlier heads.

The resulting exact head must follow the project gate:

```text
exact-head CI
-> fresh exhaustive maintainer exact-head review
-> fresh independent exact-head second opinion
   (Codex if available; quota-fallback review otherwise)
-> actionable-thread disposition
-> final exact-head checks
-> squash merge
```

No live AWS admission result is claimed by this correction.
