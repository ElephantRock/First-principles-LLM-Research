/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@fpllm/domain", "@fpllm/ui", "@fpllm/api-contracts", "@fpllm/content", "@fpllm/db", "@fpllm/github"],
  serverExternalPackages: ["pg"]
};
export default nextConfig;
