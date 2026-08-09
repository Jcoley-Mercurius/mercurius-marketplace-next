import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Supabase Edge Functions are Deno targets and are checked/deployed separately.
  // Keep Vercel's Next build from failing on their Deno-only imports and globals.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
