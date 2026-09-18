/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@fpllm/domain", "@fpllm/ui", "@fpllm/api-contracts", "@fpllm/content", "@fpllm/db", "@fpllm/github"],
  serverExternalPackages: ["pg"]
};
export default nextConfig;
