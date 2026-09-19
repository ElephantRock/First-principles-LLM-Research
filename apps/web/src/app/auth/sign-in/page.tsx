import Link from "next/link";
import { Card } from "@fpllm/ui";

export default function SignInPage() {
  const configured = Boolean(
    process.env.FPLLM_GITHUB_OAUTH_CLIENT_ID?.trim() &&
    process.env.FPLLM_GITHUB_OAUTH_CLIENT_SECRET?.trim(),
  );

  return <>
    <header className="page-header">
      <p className="eyebrow">Learner identity</p>
      <h1>Sign in to your research workspace.</h1>
      <p>Your account owns submissions, experiment evidence, mastery state, and research journal entries.</p>
    </header>
    <Card className="emphasis">
      <h2>GitHub identity</h2>
      <p className="muted">Authentication uses GitHub OAuth. Repository execution continues to use the separate least-privilege GitHub App installation.</p>
      {configured
        ? <Link className="button primary" href="/auth/github?returnTo=/home">Continue with GitHub</Link>
        : <p className="muted mono">GitHub OAuth is not configured for this deployment.</p>}
    </Card>
  </>;
}
