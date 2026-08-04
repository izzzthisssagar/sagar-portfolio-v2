import type { NextConfig } from 'next';
const config: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: ['@portfolio/types', '@portfolio/three', '@portfolio/game-engine'],
  poweredByHeader: false,
  // Produces .next/standalone — a self-contained server bundle with only the production
  // dependencies it actually traced as used, copied in by Dockerfile.web instead of shipping the
  // full monorepo node_modules into the runtime image.
  output: 'standalone',
};
export default config;
