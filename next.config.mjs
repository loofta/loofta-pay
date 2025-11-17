/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['t.me'],
  },
  webpack: config => {
    config.resolve.fallback = { fs: false };
    return config;
  }
};

export default nextConfig;
