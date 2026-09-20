# Platform v0.5 — GitHub External-Provider Limits

**Status:** P0 FROZEN COMPANION / IMPLEMENTATION NOT YET VERIFIED  
**Date checked:** 2026-09-20  
**Parent decision:** `PRODUCTION_PROVIDER_DECISIONS_v0.5.md`  
**Purpose:** close the external-provider hard-limit requirement for GitHub identity, repository authorization, and immutable-source retrieval.

---

## 0. Scope and evidence boundary

GitHub is an external production dependency even though it is not the selected infrastructure cloud. The learner loop uses it for three distinct authorities:

```text
human GitHub OAuth
!=
GitHub App user OAuth/PKCE repository proof
!=
GitHub App installation authority for repository/source reads
```

This record freezes the relevant published GitHub limits and the v0.5 beta consumption envelope. It does **not** claim that the production OAuth App/GitHub App is configured, that a real callback has succeeded, or that P2/P3 production evidence exists.

If GitHub changes a published limit below the frozen minimum envelope before provisioning or beta, P0 must be amended rather than silently increasing retries or weakening authorization checks.

---

## 1. Published GitHub limits relevant to the learner loop

The following limits were checked against GitHub's official documentation on 2026-09-20.

| Limit | Published value relevant to v0.5 | Consequence for the beta |
|---|---:|---|
| Authenticated-user REST primary limit | 5,000 requests/hour per user under the normal limit | Human OAuth and GitHub App **user** access-token requests share the user's primary budget with other OAuth/GitHub Apps and personal access tokens. The platform cannot assume the full 5,000 remains available. |
| GitHub App installation REST primary limit | minimum 5,000 requests/hour per installation | Worker repository/source reads must fit inside the installation budget. Non-Enterprise installations can scale above 5,000 based on repository/user count, up to 12,500/hour; Enterprise Cloud installations receive the documented higher limit. v0.5 plans against the **5,000/hour minimum**, not a scaled value. |
| OAuth/GitHub App access-token request limit | 2,000 access-token requests/hour per app | Human sign-in and repository user-authorization token exchanges must not be retried aggressively. |
| REST secondary concurrency limit | no more than 100 concurrent requests | v0.5 remains far below this: repository discovery is sequential and the source worker has concurrency 1. |
| REST secondary point limit | no more than 900 REST points/minute | Most GET/HEAD/OPTIONS requests cost 1 point; most mutating REST requests cost 5. Source materialization must remain bounded and sequential. |
| Secondary CPU-time limit | no more than 90 seconds of CPU time per 60 seconds of real time across REST/GraphQL, with at most 60 seconds attributable to GraphQL | v0.5 does not use GraphQL in the learner path; 403/429 secondary-limit responses still require bounded backoff. |
| Installation access-token lifetime | currently 1 hour | The worker may cache an installation token only within its expiry window; expiry is not a reason to persist a long-lived learner credential. |
| Unauthenticated REST primary limit | 60 requests/hour per originating IP | Production learner authority must not rely on this bucket; authenticated flows are required. |

GitHub documents that secondary limits may change without notice and may also be applied for undisclosed abuse-protection reasons. Therefore P1/P2/P3 must treat response headers and `403`/`429` behavior as runtime authority rather than assuming published maxima guarantee availability.

---

## 2. Current implementation request shape

### 2.1 Human sign-in

One successful human GitHub OAuth callback currently performs:

```text
1 x POST /login/oauth/access_token
1 x GET  /user
```

So a normal sign-in consumes one access-token request and one authenticated-user REST request.

### 2.2 Repository authorization through GitHub App user access

The current repository-binding proof performs:

```text
1 x POST /login/oauth/access_token
1 x GET  /user
1 x GET  /user/installations
up to 50 x GET /user/installations/{installation_id}/repositories
```

The code deliberately caps discovery at 50 installations and 500 repositories. Therefore one worst-case repository-binding attempt consumes at most **52 authenticated-user REST requests plus one access-token exchange** before returning success/failure.

This is well below the normal 5,000/hour user primary limit in isolation, but the user bucket is shared with the user's other authenticated tools. Production must inspect rate-limit response headers and fail diagnostically when the user's remaining budget is insufficient rather than looping.

### 2.3 Repository/commit verification and worker source materialization

The installation-authorized path currently uses:

```text
repository/commit resolution: 2 REST GETs
worker tree resolution:       2 REST GETs
blob materialization:         1 REST GET per regular file
```

The existing generic runtime permits up to 10,000 repository entries. That generic bound is **not acceptable as the production-beta GitHub consumption envelope**, because one pathological submission could require more requests than the 5,000/hour minimum installation budget.

P1/P3 must therefore enforce the narrower production-beta envelope in §3 before real learner submissions are enabled.

---

## 3. Frozen v0.5 GitHub consumption envelope

For the initial 3–5 learner Causal Attention beta, freeze the following production admission limits:

```text
maximum regular source files materialized per submission: 500
maximum source bytes per submission:                      128 MiB (existing bound)
maximum single blob:                                      16 MiB (existing bound)
worker submission concurrency:                            1 (existing P0 decision)
maximum materialization starts per GitHub installation:   6 per rolling hour
```

With 500 files, one worst-case accepted submission uses at most approximately:

```text
2 installation REST GETs for repository/commit resolution
2 installation REST GETs for commit/tree materialization
500 installation REST GETs for blobs
= 504 installation REST GETs
```

Six worst-case starts therefore consume at most about **3,024 installation REST GETs/hour**, leaving roughly 1,976 requests (about 39%) of the 5,000/hour minimum installation budget for token lifecycle, retries, diagnostics, other repository operations, and measurement uncertainty.

The six-start envelope is an application admission rule, not a GitHub guarantee. If GitHub reports a lower remaining budget, the lower observed budget wins.

Repositories exceeding 500 regular files must receive a deterministic beta-limit diagnostic before blob materialization; the platform must not partially materialize and then exhaust the provider quota. Raising this file cap requires either measured evidence that the provider budget remains safe or a different bounded source-transfer design.

---

## 4. Required runtime rate-limit behavior

Before P2/P3 production evidence can pass, GitHub calls in the learner path must implement and exercise all of the following:

1. capture `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `x-ratelimit-used`, and `x-ratelimit-resource` where GitHub returns them;
2. use the commit/tree response to determine the regular-file count before issuing blob reads and reject repositories above the 500-file beta envelope;
3. do not begin blob materialization unless the observed installation budget can cover the bounded request estimate plus an operational reserve;
4. on primary-limit exhaustion, defer durable work until the reset time rather than consuming infrastructure retries;
5. on `403`/`429`, honor `retry-after` when present and otherwise follow GitHub's documented bounded/exponential backoff guidance;
6. never continue hammering GitHub while rate-limited;
7. classify provider throttling distinctly from learner-correctable test failure and from internal evaluator failure;
8. expose a learner-facing terminal/deferred diagnostic rather than indefinite polling;
9. log rate-limit metadata/correlation IDs but never access tokens, client secrets, GitHub App private keys, or private repository contents;
10. retain P2/P3 evidence showing the real production App remains within this envelope during repository binding and immutable-source retrieval.

The current v0.4 implementation does not yet satisfy all of these production behaviors; this is an explicit P1/P3 implementation requirement, not retroactive verification.

---

## 5. Failure policy

GitHub availability or quota exhaustion does not create synthetic authority.

```text
GitHub unavailable / throttled
-> preserve accepted durable platform state
-> do not fabricate repository access or source evidence
-> defer/retry only within bounded provider-aware policy
-> surface diagnostic state
-> resume from supported workflow when provider authority is available
```

A GitHub rate-limit event must not be converted into a failing hidden/public learner invariant. It is an external-dependency/infrastructure condition with separate provenance.

---

## 6. Official research basis at decision freeze

Checked 2026-09-20:

- REST API primary and secondary limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub App rate limits: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps
- OAuth App rate limits: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/rate-limits-for-oauth-apps
- OAuth authorization/token issuance behavior: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- GitHub App installation access-token behavior: https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
- REST rate-limit status endpoint/headers: https://docs.github.com/en/rest/rate-limit/rate-limit

GitHub limits can change. P1 must re-check these sources immediately before production configuration, and the runtime must obey observed response headers even when they are stricter than this decision record.