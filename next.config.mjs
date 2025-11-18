/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['raw.githubusercontent.com'],
  },
  webpack: config => {
    config.resolve.fallback = { fs: false };
    return config;
  }
};

export default nextConfig;
