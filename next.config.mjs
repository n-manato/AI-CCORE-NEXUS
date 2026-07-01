/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep server-only native deps external so the build stays lean.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // Allow the dev server to serve /_next/* assets when opened from these origins
  // (e.g. the host's LAN IP), not just localhost. Needed when accessing the dev
  // server directly by IP instead of through an SSH/localhost port forward.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "").split(",").filter(Boolean),
};

export default nextConfig;
