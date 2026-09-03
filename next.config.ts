import type { NextConfig } from "next";

// Optional local verification limit for machines also running Docker/WSL.
// Keep the normal Next.js default unless explicitly requested. This changes
// concurrency only: every route and the full TypeScript check still run.
const buildWorkers = process.env.MERCURIUS_BUILD_WORKERS;
if (buildWorkers && !/^(?:[1-9]|1[0-6])$/.test(buildWorkers)) {
  throw new Error("MERCURIUS_BUILD_WORKERS must be an integer from 1 to 16.");
}

const nextConfig: NextConfig = buildWorkers
  ? { experimental: { cpus: Number(buildWorkers) } }
  : {};

export default nextConfig;
