/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['raw.githubusercontent.com', 's2.coinmarketcap.com', 'assets.coingecko.com', 'near-intents.org', 'dd.dexscreener.com', 'ipfs.sintral.me'],
  },
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
}

module.exports = nextConfig 