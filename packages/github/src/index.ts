import { createHmac, createSign, timingSafeEqual } from "node:crypto";

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function createGitHubAppJwt(input: { appId: string; privateKey: string; nowSeconds?: number }): string {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 30, exp: now + 9 * 60, iss: input.appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256"); signer.update(unsigned); signer.end();
  return `${unsigned}.${signer.sign(input.privateKey).toString("base64url")}`;
}

export function verifyGitHubWebhook(body: Buffer, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"), "utf8");
  const observed = Buffer.from(signatureHeader.slice("sha256=".length), "utf8");
  return expected.length === observed.length && timingSafeEqual(expected, observed);
}

export class GitHubAppClient {
  constructor(private readonly config: { appId: string; privateKey: string }) {}
  private jwt() { return createGitHubAppJwt(this.config); }
  async installationToken(installationId: string | number): Promise<string> {
    const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, { method: "POST", headers: { authorization: `Bearer ${this.jwt()}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "fpllm-platform" } });
    if (!response.ok) throw new Error(`GITHUB_INSTALLATION_TOKEN_FAILED:${response.status}`);
    const body = await response.json() as { token: string }; return body.token;
  }
  async resolveRepository(input: { installationId: string | number; owner: string; repo: string; ref: string }) {
    const token = await this.installationToken(input.installationId);
    const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "fpllm-platform" };
    const [repoResponse, commitResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`, { headers }),
      fetch(`https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commits/${encodeURIComponent(input.ref)}`, { headers }),
    ]);
    if (!repoResponse.ok) throw new Error(`REPOSITORY_NOT_AUTHORIZED:${repoResponse.status}`);
    if (!commitResponse.ok) throw new Error(`COMMIT_NOT_FOUND:${commitResponse.status}`);
    const repository = await repoResponse.json() as { id: number; default_branch: string; owner: { login: string }; name: string };
    const commit = await commitResponse.json() as { sha: string };
    return { repositoryId: repository.id, owner: repository.owner.login, name: repository.name, defaultBranch: repository.default_branch, commitSha: commit.sha };
  }
}
