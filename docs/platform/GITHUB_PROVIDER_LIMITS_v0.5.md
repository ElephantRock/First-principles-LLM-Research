# Platform v0.5 — GitHub External-Provider Contract

**Status:** P0 FROZEN COMPANION / IMPLEMENTATION NOT YET VERIFIED  
**Date checked:** 2026-09-20  
**Parent decision:** `PRODUCTION_PROVIDER_DECISIONS_v0.5.md`  
**Purpose:** complete the external-provider selection record for GitHub identity, repository authorization, immutable-source retrieval, permissions, limits, cost, data implications, and exit behavior.

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

This record freezes the GitHub provider/security baseline and the v0.5 beta consumption envelope. It does **not** claim that the production OAuth App/GitHub App is configured, that a real callback has succeeded, or that P2/P3 production evidence exists.

If GitHub changes a published limit, permission model, product availability, or required trust boundary below this frozen minimum before provisioning or beta, P0 must be amended rather than silently increasing privileges, retries, or operational assumptions.

---

## 1. Provider-selection record

### 1.1 Product and architecture fit

Use **GitHub.com** for:

- human identity via a dedicated OAuth App;
- repository authorization via a dedicated GitHub App user OAuth + PKCE flow;
- installation-authorized repository identity and immutable Git-object retrieval;
- learner-owned Git repositories and immutable commit SHAs.

GitHub is not the authority for platform mastery, experiments, or durable learner evidence. Those remain inside the platform database. Learner source is fetched only from the immutable commit selected for execution and is materialized ephemerally on the trusted worker host.

### 1.2 Data and region implications

GitHub.com is a separate SaaS control/data plane from the selected AWS `eu-west-1` production region. Therefore v0.5 makes **no claim that GitHub-hosted account or repository data is resident in Ireland or inside the AWS region**.

The platform sends/receives only what the learner flow requires:

```text
GitHub -> platform:
  numeric user identity + login/display metadata
  installation/repository identity and repository metadata
  commit/tree/blob data for the selected immutable source revision

platform -> GitHub:
  OAuth authorization/token-exchange requests
  GitHub App JWT / installation-token requests
  read-only repository/source API requests
```

AWS-resident durable state stores internal identity linkage, immutable GitHub numeric IDs, installation/repository IDs, owner/name/default-branch metadata, selected commit SHA, and platform evidence. OAuth user access tokens are transient and are not persisted as worker credentials. Repository source is not retained as authoritative object storage after the worker's ephemeral execution workspace is removed.

If a later release requires a contractual GitHub data-residency region, that is a new provider/product decision and is not implied by this beta baseline.

### 1.3 Minimum viable cost envelope

The initial beta requires no GitHub Enterprise Cloud feature and no paid GitHub Marketplace application plan. The **incremental platform budget assumption for GitHub App/OAuth/API use is USD 0/month** beyond whatever GitHub plans beta learners or the app-owning organization already choose to maintain.

This is not a guarantee that every learner's own GitHub account has zero cost. Learner/team/enterprise subscription choices are external to the platform budget. If P1 discovers that a required production capability demands a paid GitHub plan, P0 must be amended with that cost before relying on it.

### 1.4 Human OAuth scope and secrets

The human-identity OAuth App requests exactly:

```text
OAuth scope: read:user
```

It does **not** request `repo`, organization administration, workflow, or write scopes.

Web-only configuration/secrets:

```text
GitHub OAuth client ID       non-secret configuration
GitHub OAuth client secret   AWS Secrets Manager -> web workload only
```

The returned user OAuth access token is used to resolve `/user` during sign-in and is not persisted as platform/worker authority.

### 1.5 GitHub App permissions and secrets

The production GitHub App uses the minimum repository permissions required by the current endpoints:

```text
Repository permissions:
  Metadata: read-only
  Contents: read-only

Account permissions:
  none requested for the v0.5 learner path

Repository write permissions:
  none
Organization write/admin permissions:
  none
```

`Contents: read` is required for commit/tree/blob reads. `Metadata: read` is required for repository metadata resolution. GitHub App user access tokens remain constrained by both the app's permissions and the authorizing user's own access.

The repository user-OAuth authorization request intentionally does not add OAuth App-style scopes; GitHub App permissions are defined by the App registration and installation.

Production secret/configuration consumers:

```text
GitHub App client ID          non-secret configuration -> web
GitHub App client secret      AWS Secrets Manager -> web only (user OAuth code exchange)
GitHub App ID                 non-secret configuration -> web + worker
GitHub App private key        AWS Secrets Manager -> web bind finalization + worker source retrieval
repository-authorization key  AWS Secrets Manager -> web only; never sent to GitHub
```

P1 should provision separate active GitHub App private-key material for the web and worker workloads when GitHub key management permits overlapping keys, so one workload secret can be rotated without distributing the same private-key value to both services. Both keys still represent the same GitHub App authority and therefore do not create separate permission domains.

Learner sandboxes receive **none** of these secrets, no GitHub token, and no Docker-host credential.

Any request to add GitHub repository/account write permission reopens the security portion of P0 and requires a committed justification before P2.

### 1.6 Failure modes and exit/migration path

Material provider failures are:

- GitHub outage or degraded API availability;
- OAuth/App authorization revocation;
- installation suspension/removal or repository access removal;
- primary/secondary rate limiting;
- permission/configuration drift;
- OAuth/App secret or private-key compromise;
- repository deletion or immutable object becoming unavailable from GitHub.

These failures do not create synthetic authority. The platform preserves already-accepted durable evidence and fails/defer retries diagnostically according to the provider-aware policy below.

Exit path:

- platform domain state already distinguishes repository provider and immutable source identity;
- durable learner evidence remains PostgreSQL-owned and is not exported from GitHub;
- moving future submissions to another Git provider requires a new provider adapter and authorization contract, not reinterpretation of historical GitHub evidence;
- existing historical GitHub repository/install/commit identifiers remain immutable provenance even if GitHub is later removed as an active provider;
- no migration may silently substitute a different source object for an already-recorded GitHub commit SHA.

v0.5 itself remains GitHub-only; implementing another Git provider is out of scope.

---

## 2. Published GitHub limits relevant to the learner loop

The following limits were checked against GitHub's official documentation on 2026-09-20.

| Limit | Published value relevant to v0.5 | Consequence for the beta |
|---|---:|---|
| Authenticated-user REST primary limit | 5,000 requests/hour per user under the normal limit | Human OAuth and GitHub App **user** access-token requests share the user's primary budget with other OAuth/GitHub Apps and personal access tokens. The platform cannot assume the full 5,000 remains available. |
| GitHub App installation REST primary limit | minimum 5,000 requests/hour per installation | Worker repository/source reads must fit inside the installation budget. Non-Enterprise installations can scale above 5,000 based on repository/user count, up to 12,500/hour; Enterprise Cloud installations receive the documented higher limit. v0.5 plans against the **5,000/hour minimum**, not a scaled value. |
| OAuth/GitHub App access-token request limit | 2,000 access-token requests/hour per app | Human sign-in and repository user-authorization token exchanges must not be retried aggressively. |
| REST secondary concurrency limit | no more than 100 concurrent requests | v0.5 remains far below this: repository discovery is sequential and the source worker has concurrency 1. |
| REST secondary point limit | no more than 900 REST points/minute | Most GET/HEAD/OPTIONS requests cost 1 point; most mutating REST requests cost 5. Source materialization must remain bounded and sequential. |
| Secondary CPU-time limit | no more than 90 seconds of CPU time per 60 seconds of real time across REST/GraphQL, with at most 60 seconds attributable to GraphQL | v0.5 does not use GraphQL in the learner path; 403/429 secondary-limit responses still require bounded backoff. |
| Recursive Git tree response | maximum 100,000 entries and maximum 7 MB when `recursive` is used; larger responses may return `truncated: true` | The current worker uses recursive tree retrieval. A truncated tree is never accepted as complete immutable-source evidence. |
| Installation access-token lifetime | currently 1 hour | The worker may cache an installation token only within its expiry window; expiry is not a reason to persist a long-lived learner credential. |
| Unauthenticated REST primary limit | 60 requests/hour per originating IP | Production learner authority must not rely on this bucket; authenticated flows are required. |

GitHub documents that secondary limits may change without notice and may also be applied for undisclosed abuse-protection reasons. Therefore P1/P2/P3 must treat response headers, `truncated`, and `403`/`429` behavior as runtime authority rather than assuming published maxima guarantee availability.

---

## 3. Current implementation request shape

### 3.1 Human sign-in

One successful human GitHub OAuth callback currently performs:

```text
1 x POST /login/oauth/access_token
1 x GET  /user
```

So a normal sign-in consumes one access-token request and one authenticated-user REST request.

### 3.2 Repository authorization through GitHub App user access

The current repository-binding proof performs:

```text
1 x POST /login/oauth/access_token
1 x GET  /user
1 x GET  /user/installations
up to 50 x GET /user/installations/{installation_id}/repositories
```

The code deliberately caps discovery at 50 installations and 500 repositories. Therefore one worst-case repository-binding attempt consumes at most **52 authenticated-user REST requests plus one access-token exchange** before returning success/failure.

This is well below the normal 5,000/hour user primary limit in isolation, but the user bucket is shared with the user's other authenticated tools. Production must inspect rate-limit response headers and fail diagnostically when the user's remaining budget is insufficient rather than looping.

### 3.3 Repository/commit verification and worker source materialization

The installation-authorized path currently uses:

```text
repository/commit resolution: 2 REST GETs
worker tree resolution:       2 REST GETs
blob materialization:         1 REST GET per regular file
```

The worker tree request is recursive. The current client already rejects GitHub responses with `truncated: true`, but its generic repository bound permits up to 10,000 entries and repository-relative paths up to 4,096 characters. Those generic bounds are **not** the production-beta GitHub acceptance envelope: request quota and the provider's recursive-tree response limit require a narrower contract.

P1/P3 must enforce §4 before real learner submissions are enabled.

---

## 4. Frozen v0.5 GitHub consumption and tree envelope

For the initial 3–5 learner Causal Attention beta, an accepted production source tree must satisfy all of the following:

```text
GitHub recursive tree response truncated:                   false
maximum total entries in returned recursive tree:           2,000
maximum regular source files materialized per submission:   500
maximum repository-relative path length:                    512 UTF-8 bytes
maximum source bytes per submission:                        128 MiB (existing bound)
maximum single blob:                                        16 MiB (existing bound)
worker submission concurrency:                              1 (existing P0 decision)
maximum materialization starts per GitHub installation:     6 per rolling hour
```

The total-tree bound includes directories and non-directory Git tree entries, not only regular files. The path bound is deliberately much smaller than the generic 4,096-character safety ceiling so the beta does not depend on operating near GitHub's 7 MB recursive-response boundary.

A `truncated: true` response is an immediate provider-envelope rejection; the worker must **not** infer that the returned subset is complete and must not start blob materialization. Likewise, a non-truncated response above 2,000 total entries, above 500 materialized regular files, or containing a path above 512 UTF-8 bytes receives a deterministic beta-limit diagnostic.

With 500 files, one worst-case accepted submission uses at most approximately:

```text
2 installation REST GETs for repository/commit resolution
2 installation REST GETs for commit/tree materialization
500 installation REST GETs for blobs
= 504 installation REST GETs
```

Six worst-case starts therefore consume at most about **3,024 installation REST GETs/hour**, leaving roughly 1,976 requests (about 39%) of the 5,000/hour minimum installation budget for token lifecycle, retries, diagnostics, other repository operations, and measurement uncertainty.

The six-start envelope is an application admission rule, not a GitHub guarantee. If GitHub reports a lower remaining budget, the lower observed budget wins.

Raising any tree/file/path cap requires either measured evidence that both the GitHub request budget and recursive-tree response remain safe or a different bounded source-transfer strategy, such as reviewed non-recursive tree traversal.

---

## 5. Required runtime provider-limit behavior

Before P2/P3 production evidence can pass, GitHub calls in the learner path must implement and exercise all of the following:

1. capture `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `x-ratelimit-used`, and `x-ratelimit-resource` where GitHub returns them;
2. treat `truncated: true` from recursive tree retrieval as a deterministic provider-envelope rejection, never as a partial-but-usable manifest;
3. validate total returned tree entries <= 2,000 and every repository-relative path <= 512 UTF-8 bytes before issuing blob reads;
4. validate regular materialized files <= 500 before issuing blob reads;
5. do not begin blob materialization unless the observed installation budget can cover the bounded request estimate plus an operational reserve;
6. on primary-limit exhaustion, defer durable work until the reset time rather than consuming infrastructure retries;
7. on `403`/`429`, honor `retry-after` when present and otherwise follow GitHub's documented bounded/exponential backoff guidance;
8. never continue hammering GitHub while rate-limited;
9. classify provider throttling/tree-envelope rejection distinctly from learner-correctable test failure and from internal evaluator failure;
10. expose a learner-facing terminal/deferred diagnostic rather than indefinite polling;
11. log rate-limit metadata/correlation IDs but never access tokens, client secrets, GitHub App private keys, or private repository contents;
12. retain P2/P3 evidence showing the real production App remains within this envelope during repository binding and immutable-source retrieval.

The current v0.4 implementation does not yet satisfy all of these production behaviors; this is an explicit P1/P3 implementation requirement, not retroactive verification.

---

## 6. Failure policy

GitHub availability, authorization loss, tree truncation, or quota exhaustion does not create synthetic authority.

```text
GitHub unavailable / unauthorized / throttled / source outside envelope
-> preserve accepted durable platform state
-> do not fabricate repository access or source evidence
-> defer/retry only where the condition is retryable under bounded provider-aware policy
-> surface diagnostic state
-> resume from supported workflow only when provider authority/envelope is valid
```

A GitHub provider failure must not be converted into a failing hidden/public learner invariant. It is an external-dependency/infrastructure or explicit beta-envelope condition with separate provenance.

---

## 7. Official research basis at decision freeze

Checked 2026-09-20:

- REST API primary and secondary limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub App rate limits: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps
- OAuth App rate limits: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/rate-limits-for-oauth-apps
- OAuth scopes: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
- OAuth authorization/token issuance behavior: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- GitHub App permission selection: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- REST permissions required for GitHub Apps: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
- GitHub App user-access behavior: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- GitHub App installation access-token behavior: https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
- Git tree recursive-response limits: https://docs.github.com/en/rest/git/trees#get-a-tree
- REST rate-limit status endpoint/headers: https://docs.github.com/en/rest/rate-limit/rate-limit
- GitHub plan pricing baseline: https://github.com/pricing

GitHub limits, permissions, products, and prices can change. P1 must re-check these sources immediately before production configuration, and the runtime must obey observed provider responses even when they are stricter than this decision record.