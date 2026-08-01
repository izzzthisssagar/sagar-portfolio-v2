import type { NextConfig } from 'next';
const config: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: ['@portfolio/types', '@portfolio/three', '@portfolio/game-engine'],
  poweredByHeader: false,
};
export default config;
