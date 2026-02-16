import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Expose build-time env to client (NEXT_PUBLIC_* are inlined at build).
  // For Vercel Preview: set these in Project → Settings → Environment Variables for "Preview".
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  },
  // Externalize problematic packages to avoid bundling issues
  serverExternalPackages: [
    'pino',
    'thread-stream',
    '@walletconnect/sign-client',
    '@walletconnect/core',
    '@walletconnect/ethereum-provider',
    '@supabase/supabase-js',
  ],
  turbopack: {
    resolveAlias: {
      fs: { browser: './empty-module.js' },
      net: { browser: './empty-module.js' },
      tls: { browser: './empty-module.js' },
    },
    resolveExtensions: ['.wasm', '.js', '.json', '.ts', '.tsx'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
      { protocol: 'https', hostname: 's2.coinmarketcap.com' },
      { protocol: 'https', hostname: 'assets.coingecko.com' },
      { protocol: 'https', hostname: 'near-intents.org' },
      { protocol: 'https', hostname: 'dd.dexscreener.com' },
      { protocol: 'https', hostname: 'ipfs.sintral.me' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
      { protocol: 'https', hostname: '*.giphy.com' },
      { protocol: 'https', hostname: 'media.giphy.com' },
      { protocol: 'https', hostname: 'i.giphy.com' },
      { protocol: 'https', hostname: 'm.media-amazon.com' },
    ],
  },
  // Suppress React hydration warnings from Privy (third-party library issue)
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
  // Content Security Policy for Privy authentication
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://unpkg.com https://*.spline.design https://*.splinetool.com https://auth.privy.io https://*.privy.io https://vercel.live",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com https://cdn.fontshare.com",
              "img-src 'self' data: blob: https://raw.githubusercontent.com https://s2.coinmarketcap.com https://assets.coingecko.com https://near-intents.org https://dd.dexscreener.com https://ipfs.sintral.me https://*.walletconnect.com https://*.spline.design https://*.splinetool.com https://*.supabase.co https://*.supabase.in https://api.qrserver.com https://*.giphy.com https://media.giphy.com https://i.giphy.com https://m.media-amazon.com",
              "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com https://cdn.fontshare.com https://api.fontshare.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org blob:",
              "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://*.spline.design https://*.splinetool.com",
              "connect-src 'self' https://auth.privy.io https://*.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://api.web3modal.com https://api.web3modal.org https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://1click.chaindefuser.com https://*.chaindefuser.com https://*.defuse.org https://*.near.org https://*.near-intents.org https://explorer.near-intents.org https://*.rhinestone.dev https://*.biconomy.io https://network.biconomy.io https://api.loom.com https://*.vercel-insights.com https://*.vercel-analytics.com https://*.spline.design https://*.splinetool.com https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.fontshare.com https://api.fontshare.com https://mainnet.base.org https://eth.llamarpc.com https://*.llamarpc.com https://mainnet.optimism.io https://arb1.arbitrum.io https://*.arbitrum.io https://ipapi.co https://*.ipapi.co http://localhost:3001 https://*.up.railway.app https://*.railway.app https://api.giphy.com https://api.mainnet-beta.solana.com https://*.solana.com https://mainnet.helius-rpc.com https://*.helius-rpc.com wss://mainnet.helius-rpc.com wss://*.helius-rpc.com",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              "media-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
