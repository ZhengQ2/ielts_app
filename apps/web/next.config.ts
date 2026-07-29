import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  // @ielts-map/core ships TypeScript source rather than a build artifact, so a
  // future React Native client can consume the same files through Metro.
  transpilePackages: ['@ielts-map/core'],
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
};

export default config;
