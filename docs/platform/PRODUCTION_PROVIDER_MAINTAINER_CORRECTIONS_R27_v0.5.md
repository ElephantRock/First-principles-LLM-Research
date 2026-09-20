# Platform v0.5 — Maintainer Corrections Round 27 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `bb17c6546e071cf863369ed33166c502c1ca72b4`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and provider-limit correction

A final provider-limit pass over the R24–R26 emergency path found two provider-contract details that must be explicit before P0 closes:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR27-01 | HIGH | R24 described the emergency IAM role itself as having a 15-minute maximum session duration. AWS IAM `MaxSessionDuration` cannot be configured below 3,600 seconds even though STS `AssumeRole` can request a 900-second session. | Freeze role `MaxSessionDuration=3600` and keep the broker request `DurationSeconds=900`. Direct assumption remains impossible because the role trusts only the protected broker. |
| FPR27-02 | MEDIUM | R25 introduced restrictive inline STS session policies/tags without recording the relevant STS request-size limits. A repair profile can otherwise be valid semantically but fail at credential issuance. | Freeze bounded inline-policy/tag/session-name envelopes below provider limits and require provider-limit validation in P1. No managed session policy ARNs are selected for v0.5. |

Provider sources:

- IAM role `MaxSessionDuration` valid range 3,600–43,200 seconds: <https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateRole.html>
- STS `AssumeRole` `DurationSeconds` minimum 900 seconds and inline/managed session-policy plaintext total limit 2,048 characters: <https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html>

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R27_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R26_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R25_v0.5.md
    > ...
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Emergency IAM role duration — PROVIDER-VALID

The production emergency provider role is configured as:

```text
role:               fpllm-beta-emergency-break-glass
MaxSessionDuration: 3600 seconds
trust:              protected incident broker only
```

The protected broker always calls STS with:

```text
DurationSeconds = 900
```

Thus the IAM role configuration satisfies the provider's one-hour minimum role maximum while the issued v0.5 emergency credential still lasts only the provider-valid 15-minute minimum requested by the broker.

R24 wording that implied `MaxSessionDuration=900` is superseded.

The emergency operator still cannot directly assume the role, so the role's one-hour configured maximum does not create a human-selectable one-hour credential path.

---

# 2. STS repair-profile request envelope — FROZEN

For v0.5, repair profiles use **one inline session policy only**. Managed session policy ARNs are not selected.

Each canonical inline session-policy JSON document must satisfy:

```text
UTF-8/STS-compatible plaintext length <= 1800 characters
provider hard combined session-policy plaintext limit = 2048 characters
```

The project-level 1,800-character ceiling deliberately leaves headroom beneath the provider's 2,048-character hard limit. A profile exceeding the project ceiling is rejected at build/admission time and requires profile redesign rather than runtime truncation.

No caller-supplied policy text or managed policy ARN is accepted.

## 2.1 Session tags

The broker emits a fixed, server-owned tag schema only. For v0.5:

```text
number of session tags <= 6
each tag key length     <= 64 characters
each tag value length   <= 128 characters
```

These project ceilings are intentionally below AWS STS's documented broader tag limits. The caller cannot add arbitrary tags.

Required semantic bindings remain incident ID/epoch, actor/audit identity, and repair-profile/resource-scope commitment, but values may use bounded hashes/identifiers rather than unbounded human text.

## 2.2 Role session name

The broker server-generates a role session name with a deterministic bounded format such as:

```text
fpllm-bg-<bounded base32/hex incident-session-attempt suffix>
```

and must keep it within the STS `RoleSessionName` provider constraints. Human incident reasons, repository names, or other unbounded text are never embedded in the role session name.

## 2.3 Packed provider representation

AWS may reject an STS request with `PackedPolicyTooLarge` even when individual plaintext policy/tag limits are satisfied because policies and tags are additionally packed into an internal representation.

Therefore:

- each frozen repair profile must pass a real P1 provider issuance test with the exact production tag schema;
- a provider packed-size rejection is fail-closed and does not trigger policy/tag truncation or authority broadening;
- the session logical attempt remains durably recorded under the R25/R26 dispatch/ambiguity rules;
- failed issuance cannot be classified as an issued credential unless provider acceptance is uncertain, in which case conservative ambiguity handling remains mandatory.

No emergency repair profile is production-admissible merely because local JSON validation succeeds.

---

# 3. Repair-profile registry admission — STRENGTHENED

Before P1 deploys a repair profile, retain a machine-readable profile manifest containing at minimum:

```text
repairProfileId
canonical inline session-policy JSON
canonical policy character count
canonical policy sha256
fixed tag schema/count and maximum encoded lengths
role-session-name generator/version and maximum length
DurationSeconds = 900
expected base role = fpllm-beta-emergency-break-glass
provider validation timestamp/evidence reference
```

The broker only resolves profiles whose manifest is in the protected deployed allowlist. A GitHub-controlled caller, emergency operator, or audit detector cannot dynamically add or modify a repair profile at invocation time.

Profile-policy changes are protected-stack maintenance and remain subject to the maintenance/incident fencing rules; emergency break-glass cannot rewrite its own future permission profiles as part of a normal session request.

---

# 4. Required P1 evidence additions

In addition to every earlier gate, P1 must prove:

1. the emergency IAM role is actually configured with `MaxSessionDuration=3600` and trusts only the protected incident broker;
2. every broker `AssumeRole` request uses exact `DurationSeconds=900`;
3. no repair profile uses managed session policy ARNs and every inline policy is <=1,800 characters before provider submission;
4. the caller cannot inject inline/managed policies, arbitrary tags, role ARN, session duration, or role session name;
5. the fixed tag schema remains within project ceilings and the generated role session name remains within provider constraints;
6. each deployed repair profile successfully completes a real STS issuance test with its exact inline policy and production tag schema without packed-size failure;
7. forced `PackedPolicyTooLarge`/malformed-policy/provider rejection fails closed without truncation or broadened fallback;
8. repair-profile changes use protected maintenance authority and cannot be rewritten by an emergency session itself;
9. R26's overlap reconciliation and conservative ambiguous-session expiry tests remain green with the provider-valid role/session configuration.

---

# 5. Review-state boundary

Round 27 closes FPR27-01 and FPR27-02 at the decision/specification level only.

It does **not** claim IAM role configuration, STS issuance, policy-size validation, packed-size behavior, repair-profile deployment, effective permissions, quota availability, or production AWS evidence are implemented.

The resulting exact HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```
