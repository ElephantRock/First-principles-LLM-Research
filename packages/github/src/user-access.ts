const GITHUB_API_VERSION = "2022-11-28";
const MAX_INSTALLATIONS = 50;
const MAX_REPOSITORIES_SCANNED = 500;

function userHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "fpllm-platform",
  };
}

export interface GitHubUserProfile {
  id: number;
  login: string;
}

export interface GitHubUserRepositoryAuthorization {
  installationId: number;
  installationAccountLogin: string;
  installationAccountType: string;
  repositoryId: number;
  owner: string;
  name: string;
  defaultBranch: string;
}

export async function exchangeGitHubAppUserCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "fpllm-platform",
    },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GITHUB_APP_USER_TOKEN_EXCHANGE_FAILED:${response.status}`);
  const body = await response.json() as { access_token?: string; error?: string };
  if (!body.access_token || body.error) throw new Error(`GITHUB_APP_USER_TOKEN_REJECTED:${body.error ?? "missing_token"}`);
  return body.access_token;
}

export async function getGitHubUserProfile(token: string): Promise<GitHubUserProfile> {
  const response = await fetch("https://api.github.com/user", {
    headers: userHeaders(token),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GITHUB_APP_USER_PROFILE_FAILED:${response.status}`);
  const body = await response.json() as { id?: number; login?: string };
  if (!Number.isSafeInteger(body.id) || !body.login) throw new Error("GITHUB_APP_USER_PROFILE_INVALID");
  return { id: body.id as number, login: body.login };
}

/**
 * Prove that a GitHub App user access token can reach one concrete repository.
 * The token is intentionally caller-owned and need not be persisted.
 */
export async function findGitHubUserAccessibleRepository(input: {
  token: string;
  owner: string;
  repo: string;
}): Promise<GitHubUserRepositoryAuthorization> {
  const headers = userHeaders(input.token);
  const targetOwner = input.owner.toLowerCase();
  const targetRepo = input.repo.toLowerCase();
  let installationsSeen = 0;
  let repositoriesSeen = 0;

  for (let installationPage = 1; installationsSeen < MAX_INSTALLATIONS; installationPage += 1) {
    const response = await fetch(
      `https://api.github.com/user/installations?per_page=100&page=${installationPage}`,
      { headers, cache: "no-store" },
    );
    if (!response.ok) throw new Error(`GITHUB_USER_INSTALLATIONS_FAILED:${response.status}`);
    const body = await response.json() as {
      installations?: Array<{
        id: number;
        account?: { login?: string; type?: string };
      }>;
    };
    const installations = body.installations ?? [];
    if (installations.length === 0) break;

    for (const installation of installations) {
      installationsSeen += 1;
      if (installationsSeen > MAX_INSTALLATIONS) break;
      if (!Number.isSafeInteger(installation.id)) continue;

      for (let repositoryPage = 1; repositoriesSeen < MAX_REPOSITORIES_SCANNED; repositoryPage += 1) {
        const repoResponse = await fetch(
          `https://api.github.com/user/installations/${installation.id}/repositories?per_page=100&page=${repositoryPage}`,
          { headers, cache: "no-store" },
        );
        if (!repoResponse.ok) {
          if (repoResponse.status === 403 || repoResponse.status === 404) break;
          throw new Error(`GITHUB_USER_INSTALLATION_REPOSITORIES_FAILED:${repoResponse.status}`);
        }
        const repoBody = await repoResponse.json() as {
          repositories?: Array<{
            id: number;
            name: string;
            default_branch: string;
            owner: { login: string };
          }>;
        };
        const repositories = repoBody.repositories ?? [];
        if (repositories.length === 0) break;
        for (const repository of repositories) {
          repositoriesSeen += 1;
          if (repositoriesSeen > MAX_REPOSITORIES_SCANNED) {
            throw new Error("GITHUB_REPOSITORY_DISCOVERY_LIMIT_EXCEEDED");
          }
          if (
            repository.owner.login.toLowerCase() === targetOwner &&
            repository.name.toLowerCase() === targetRepo
          ) {
            return {
              installationId: installation.id,
              installationAccountLogin: installation.account?.login ?? repository.owner.login,
              installationAccountType: installation.account?.type ?? "Unknown",
              repositoryId: repository.id,
              owner: repository.owner.login,
              name: repository.name,
              defaultBranch: repository.default_branch,
            };
          }
        }
        if (repositories.length < 100) break;
      }
    }
    if (installations.length < 100) break;
  }

  throw new Error("GITHUB_REPOSITORY_NOT_ACCESSIBLE_TO_USER");
}
