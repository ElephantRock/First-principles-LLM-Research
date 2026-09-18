import { repositoryBindSchema } from "@fpllm/api-contracts";
import { getDemoUser, prisma } from "@fpllm/db";
import { GitHubAppClient } from "@fpllm/github";
import { NextResponse } from "next/server";

function client() {
  const appId=process.env.GITHUB_APP_ID, key=process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n","\n");
  if(!appId||!key) throw new Error("GITHUB_APP_NOT_CONFIGURED");
  return new GitHubAppClient({appId,privateKey:key});
}
export async function POST(request:Request){const parsed=repositoryBindSchema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({ok:false,code:"REQUEST_INVALID",errors:parsed.error.flatten()},{status:400});try{const user=await getDemoUser();const resolved=await client().resolveRepository(parsed.data);const installation=await prisma.gitHubInstallation.upsert({where:{githubInstallationId:BigInt(parsed.data.installationId)},update:{accountLogin:resolved.owner,accountType:"User"},create:{githubInstallationId:BigInt(parsed.data.installationId),accountLogin:resolved.owner,accountType:"User"}});const repository=await prisma.repository.upsert({where:{userId_provider_owner_name:{userId:user.id,provider:"github",owner:resolved.owner,name:resolved.name}},update:{githubInstallationDbId:installation.id,providerRepositoryId:BigInt(resolved.repositoryId),defaultBranch:resolved.defaultBranch},create:{userId:user.id,provider:"github",owner:resolved.owner,name:resolved.name,githubInstallationDbId:installation.id,providerRepositoryId:BigInt(resolved.repositoryId),defaultBranch:resolved.defaultBranch}});await prisma.repositoryBinding.upsert({where:{repositoryId_githubInstallationDbId:{repositoryId:repository.id,githubInstallationDbId:installation.id}},update:{},create:{repositoryId:repository.id,githubInstallationDbId:installation.id}});return NextResponse.json({ok:true,repository:{id:repository.id,owner:repository.owner,name:repository.name,defaultBranch:repository.defaultBranch},resolvedCommit:resolved.commitSha});}catch(error){const code=error instanceof Error?error.message:"REPOSITORY_BIND_FAILED";return NextResponse.json({ok:false,code},{status:code.includes("NOT_CONFIGURED")?503:409});}}
