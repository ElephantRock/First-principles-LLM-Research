import Link from "next/link";
import { cookies } from "next/headers";
import { Badge, Card } from "@fpllm/ui";
import {
  getCurrentLearner,
  REPOSITORY_AUTHORIZATION_COOKIE_NAME,
  repositoryAuthorizationSecret,
  verifyRepositoryAuthorization,
} from "@/lib/auth";
import { getLearnerSnapshot, shortSha } from "@/lib/persistence";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ authorized?: string; bound?: string; error?: string; ref?: string }>;

export default async function RepositorySetupPage({ searchParams }: { searchParams: SearchParams }) {
  const [snap, current, params, cookieStore] = await Promise.all([
    getLearnerSnapshot(),
    getCurrentLearner(),
    searchParams,
    cookies(),
  ]);
  const appSlug = process.env.GITHUB_APP_SLUG?.trim();
  const installUrl = appSlug && /^[A-Za-z0-9-]+$/.test(appSlug)
    ? `https://github.com/apps/${appSlug}/installations/new`
    : null;

  let authorization = null;
  if (current?.mode === "session" && current.session) {
    const token = cookieStore.get(REPOSITORY_AUTHORIZATION_COOKIE_NAME)?.value;
    if (token) {
      try {
        authorization = verifyRepositoryAuthorization({
          token,
          secret: repositoryAuthorizationSecret(),
          userId: current.user.id,
          sessionId: current.session.id,
        });
      } catch {
        authorization = null;
      }
    }
  }

  const verifiedRef = params.ref || authorization?.defaultBranch || "main";

  return <>
    <header className="page-header">
      <p className="eyebrow">Technical onboarding</p>
      <h1>Course repository</h1>
      <p>Repository bindings are learner-owned evidence references. GitHub OAuth identifies you; the GitHub App separately authorizes repository access.</p>
    </header>

    {params.error ? <div className="callout negative"><strong>Repository authorization failed.</strong><p className="small mono">{params.error}</p></div> : null}
    {params.bound ? <div className="callout positive"><strong>Repository bound.</strong><p className="small">The binding is now attached to your learner identity.</p></div> : null}

    <Card>
      <div className="split">
        <div>
          <p className="eyebrow">Current binding</p>
          <h2>{snap.repository ? `${snap.repository.owner}/${snap.repository.name}` : "Not bound"}</h2>
          <p className="small muted">Latest submission commit <span className="mono">{shortSha(snap.submission?.commitSha)}</span></p>
        </div>
        <Badge tone={snap.repository ? "positive" : "warning"}>{snap.repository ? "Connected" : "Required"}</Badge>
      </div>
    </Card>

    <div className="grid-2">
      <Card>
        <p className="eyebrow">1 · Install or configure</p>
        <h2>GitHub App access</h2>
        <p className="small muted">Grant the course GitHub App access only to the repository you intend to submit. The worker later checks out exact immutable commits through this installation.</p>
        {installUrl
          ? <a className="secondary-button" href={installUrl} target="_blank" rel="noreferrer">Install / configure GitHub App</a>
          : <p className="small muted mono">GITHUB_APP_SLUG is not configured for this deployment.</p>}
      </Card>

      <Card>
        <p className="eyebrow">2 · Prove your access</p>
        <h2>Authorize one repository</h2>
        <p className="small muted">A short-lived GitHub App user token is used only during this authorization round-trip. It is not persisted.</p>
        {current?.mode === "session" ? <form className="form-grid" method="get" action="/auth/github-app">
          <div className="form-field"><label htmlFor="repo-owner">Owner</label><input id="repo-owner" name="owner" required maxLength={100} placeholder="your-github-handle" /></div>
          <div className="form-field"><label htmlFor="repo-name">Repository</label><input id="repo-name" name="repo" required maxLength={100} placeholder="first-principles-llm-research" /></div>
          <div className="form-field"><label htmlFor="repo-ref">Initial ref</label><input id="repo-ref" name="ref" required maxLength={255} defaultValue="main" /></div>
          <button className="button primary" type="submit">Authorize repository</button>
        </form> : <p className="small muted">Sign in with a real learner session to authorize a new repository.</p>}
      </Card>
    </div>

    {authorization ? <Card className="emphasis">
      <p className="eyebrow">3 · Verified repository</p>
      <h2>{authorization.owner}/{authorization.repo}</h2>
      <p className="small muted">GitHub confirmed that your user access token can reach this repository through installation <span className="mono">{authorization.installationId}</span>. Bind it before the 10-minute authorization expires.</p>
      <form className="form-grid" method="post" action="/api/v1/repositories/bind">
        <input type="hidden" name="authorization" value={cookieStore.get(REPOSITORY_AUTHORIZATION_COOKIE_NAME)?.value ?? ""} />
        <div className="form-field"><label htmlFor="verified-ref">Commit or branch to verify</label><input id="verified-ref" name="ref" required maxLength={255} defaultValue={verifiedRef} /></div>
        <button className="button primary" type="submit">Bind verified repository</button>
      </form>
    </Card> : null}

    <div className="page-actions">
      <Link className="button primary" href="/home">Continue to dashboard</Link>
    </div>
  </>;
}
