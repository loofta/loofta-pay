/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['raw.githubusercontent.com', 's2.coinmarketcap.com', 'assets.coingecko.com', 'near-intents.org', 'dd.dexscreener.com', 'ipfs.sintral.me'],
  },
  webpack: config => {
    config.resolve.fallback = { fs: false };
    return config;
  }
};

export default nextConfig;
