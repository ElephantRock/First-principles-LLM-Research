import { createHmac, createSign, timingSafeEqual } from "node:crypto";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const FULL_GIT_OBJECT_SHA = /^[0-9a-f]{40}$/i;
const MAX_TREE_ENTRIES = 10_000;
const MAX_REPOSITORY_BYTES = 128 * 1024 * 1024;
const MAX_BLOB_BYTES = 16 * 1024 * 1024;
const TOKEN_REFRESH_SKEW_MS = 60_000;

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function apiRepo(owner: string, repo: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function createGitHubAppJwt(input: { appId: string; privateKey: string; nowSeconds?: number }): string {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 30, exp: now + 9 * 60, iss: input.appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(input.privateKey).toString("base64url")}`;
}

export function verifyGitHubWebhook(body: Buffer, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"), "utf8");
  const observed = Buffer.from(signatureHeader.slice("sha256=".length), "utf8");
  return expected.length === observed.length && timingSafeEqual(expected, observed);
}

export interface GitHubRepositoryTreeBlob {
  path: string;
  mode: "100644" | "100755";
  sha: string;
  size: number;
}

export class GitHubAppClient {
  private readonly tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

  constructor(private readonly config: { appId: string; privateKey: string }) {}

  private jwt() {
    return createGitHubAppJwt(this.config);
  }

  private async installationHeaders(installationId: string | number) {
    const token = await this.installationToken(installationId);
    return {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "fpllm-platform",
    };
  }

  async installationToken(installationId: string | number): Promise<string> {
    const cacheKey = String(installationId);
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS > Date.now()) return cached.token;

    const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.jwt()}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "fpllm-platform",
      },
    });
    if (!response.ok) throw new Error(`GITHUB_INSTALLATION_TOKEN_FAILED:${response.status}`);
    const body = await response.json() as { token: string; expires_at: string };
    const expiresAtMs = new Date(body.expires_at).getTime();
    if (!body.token || !Number.isFinite(expiresAtMs)) throw new Error("GITHUB_INSTALLATION_TOKEN_INVALID");
    this.tokenCache.set(cacheKey, { token: body.token, expiresAtMs });
    return body.token;
  }

  async resolveRepository(input: { installationId: string | number; owner: string; repo: string; ref: string }) {
    const headers = await this.installationHeaders(input.installationId);
    const [repoResponse, commitResponse] = await Promise.all([
      fetch(apiRepo(input.owner, input.repo), { headers }),
      fetch(`${apiRepo(input.owner, input.repo)}/commits/${encodeURIComponent(input.ref)}`, { headers }),
    ]);
    if (!repoResponse.ok) throw new Error(`REPOSITORY_NOT_AUTHORIZED:${repoResponse.status}`);
    if (!commitResponse.ok) throw new Error(`COMMIT_NOT_FOUND:${commitResponse.status}`);
    const repository = await repoResponse.json() as {
      id: number;
      default_branch: string;
      owner: { login: string };
      name: string;
    };
    const commit = await commitResponse.json() as { sha: string };
    return {
      repositoryId: repository.id,
      owner: repository.owner.login,
      name: repository.name,
      defaultBranch: repository.default_branch,
      commitSha: commit.sha,
    };
  }

  /**
   * Resolve an exact commit into a bounded regular-file manifest. Symlinks,
   * submodules and oversized/truncated trees are rejected before the worker
   * writes anything to disk.
   */
  async repositoryTree(input: {
    installationId: string | number;
    owner: string;
    repo: string;
    commitSha: string;
  }): Promise<readonly GitHubRepositoryTreeBlob[]> {
    if (!FULL_GIT_SHA.test(input.commitSha)) throw new Error("COMMIT_SHA_INVALID");
    const headers = await this.installationHeaders(input.installationId);
    const repositoryUrl = apiRepo(input.owner, input.repo);

    const commitResponse = await fetch(`${repositoryUrl}/git/commits/${input.commitSha}`, { headers });
    if (!commitResponse.ok) throw new Error(`GITHUB_COMMIT_FETCH_FAILED:${commitResponse.status}`);
    const commit = await commitResponse.json() as { sha: string; tree: { sha: string } };
    if (commit.sha.toLowerCase() !== input.commitSha.toLowerCase()) throw new Error("GITHUB_COMMIT_IDENTITY_MISMATCH");
    if (!FULL_GIT_OBJECT_SHA.test(commit.tree?.sha ?? "")) throw new Error("GITHUB_TREE_SHA_INVALID");

    const treeResponse = await fetch(`${repositoryUrl}/git/trees/${commit.tree.sha}?recursive=1`, { headers });
    if (!treeResponse.ok) throw new Error(`GITHUB_TREE_FETCH_FAILED:${treeResponse.status}`);
    const body = await treeResponse.json() as {
      truncated: boolean;
      tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }>;
    };
    if (body.truncated) throw new Error("GITHUB_TREE_TRUNCATED");
    if (body.tree.length > MAX_TREE_ENTRIES) throw new Error("GITHUB_TREE_TOO_LARGE");

    const blobs: GitHubRepositoryTreeBlob[] = [];
    let totalBytes = 0;
    for (const entry of body.tree) {
      if (entry.type === "tree") continue;
      if (entry.type !== "blob") throw new Error(`GITHUB_TREE_ENTRY_UNSUPPORTED:${entry.type}`);
      if (entry.mode !== "100644" && entry.mode !== "100755") {
        throw new Error(`GITHUB_TREE_MODE_UNSUPPORTED:${entry.mode}`);
      }
      if (!FULL_GIT_OBJECT_SHA.test(entry.sha)) throw new Error("GITHUB_BLOB_SHA_INVALID");
      if (entry.size === undefined) throw new Error("GITHUB_BLOB_SIZE_MISSING");
      const size = entry.size;
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BLOB_BYTES) throw new Error("GITHUB_BLOB_TOO_LARGE");
      totalBytes += size;
      if (totalBytes > MAX_REPOSITORY_BYTES) throw new Error("GITHUB_REPOSITORY_TOO_LARGE");
      blobs.push({ path: entry.path, mode: entry.mode, sha: entry.sha, size });
    }
    return blobs;
  }

  async repositoryBlob(input: {
    installationId: string | number;
    owner: string;
    repo: string;
    blobSha: string;
    expectedSize: number;
  }): Promise<Uint8Array> {
    if (!FULL_GIT_OBJECT_SHA.test(input.blobSha)) throw new Error("GITHUB_BLOB_SHA_INVALID");
    if (!Number.isSafeInteger(input.expectedSize) || input.expectedSize < 0 || input.expectedSize > MAX_BLOB_BYTES) {
      throw new Error("GITHUB_BLOB_SIZE_INVALID");
    }
    const headers = await this.installationHeaders(input.installationId);
    const response = await fetch(`${apiRepo(input.owner, input.repo)}/git/blobs/${input.blobSha}`, { headers });
    if (!response.ok) throw new Error(`GITHUB_BLOB_FETCH_FAILED:${response.status}`);
    const body = await response.json() as { content: string; encoding: string; size: number; sha: string };
    if (body.encoding !== "base64") throw new Error("GITHUB_BLOB_ENCODING_UNSUPPORTED");
    if (body.sha !== input.blobSha || body.size !== input.expectedSize) throw new Error("GITHUB_BLOB_IDENTITY_MISMATCH");
    const decoded = Buffer.from(body.content.replaceAll("\n", ""), "base64");
    if (decoded.byteLength !== input.expectedSize || decoded.byteLength > MAX_BLOB_BYTES) {
      throw new Error("GITHUB_BLOB_SIZE_MISMATCH");
    }
    return new Uint8Array(decoded);
  }
}
