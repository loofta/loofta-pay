/** @type {import('next').NextConfig} */
const nextConfig = {
  // Externalize problematic packages to avoid bundling issues
  serverExternalPackages: [
    'pino',
    'thread-stream',
    '@walletconnect/sign-client',
    '@walletconnect/core',
    '@walletconnect/ethereum-provider',
    '@supabase/supabase-js',
  ],
  // Turbopack configuration (used in dev with --turbopack)
  turbopack: {
    resolveAlias: {
      fs: { browser: './empty-module.js' },
      net: { browser: './empty-module.js' },
      tls: { browser: './empty-module.js' },
    },
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
    ],
  },
  webpack: (config) => {
    config.resolve.fallback = { 
      ...config.resolve.fallback,
      fs: false, 
      net: false, 
      tls: false 
    };
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    // Suppress Spline critical dependency warnings
    config.ignoreWarnings = [
      { module: /@splinetool/ },
    ];
    return config;
  },
  // Content Security Policy for Privy authentication
  // https://docs.privy.io/guides/security/content-security-policy
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              // Default fallback
              "default-src 'self'",
              // Scripts - self + Cloudflare Turnstile + Spline + inline for Next.js
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://unpkg.com https://*.spline.design https://*.splinetool.com",
              // Styles - self + inline + Google Fonts + Fontshare
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com https://cdn.fontshare.com",
              // Images - self + data URIs + blob + external image sources + Spline + Supabase Storage
              "img-src 'self' data: blob: https://raw.githubusercontent.com https://s2.coinmarketcap.com https://assets.coingecko.com https://near-intents.org https://dd.dexscreener.com https://ipfs.sintral.me https://*.walletconnect.com https://*.spline.design https://*.splinetool.com https://*.supabase.co https://*.supabase.in",
              // Fonts - Google Fonts + Fontshare
              "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com https://cdn.fontshare.com https://api.fontshare.com",
              // No plugins
              "object-src 'none'",
              // Base URI
              "base-uri 'self'",
              // Form submissions
              "form-action 'self'",
              // Prevent embedding (clickjacking protection)
              "frame-ancestors 'none'",
              // Child frames - Privy + WalletConnect + Spline
              "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org blob:",
              // Iframes - Privy + WalletConnect + Cloudflare
              "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://*.spline.design https://*.splinetool.com",
              // API connections - Privy + WalletConnect + Web3Modal + your APIs + Spline + Fonts + RPC
              "connect-src 'self' https://auth.privy.io https://*.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://api.web3modal.com https://api.web3modal.org https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://1click.chaindefuser.com https://*.chaindefuser.com https://*.defuse.org https://*.near.org https://*.near-intents.org https://explorer.near-intents.org https://*.rhinestone.dev https://*.biconomy.io https://network.biconomy.io https://api.loom.com https://*.vercel-insights.com https://*.vercel-analytics.com https://*.spline.design https://*.splinetool.com https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.fontshare.com https://api.fontshare.com https://mainnet.base.org https://eth.llamarpc.com https://*.llamarpc.com https://mainnet.optimism.io https://arb1.arbitrum.io https://*.arbitrum.io https://ipapi.co https://*.ipapi.co",
              // Web workers - allow blob for Spline WASM workers
              "worker-src 'self' blob:",
              // Manifest
              "manifest-src 'self'",
              // Media (for audio/video if needed)
              "media-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
