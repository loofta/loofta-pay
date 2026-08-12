import path from 'path';
import { fileURLToPath } from 'url';
import createNextIntlPlugin from 'next-intl/plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
    'sharp',
  ],
  experimental: {
    // Tree-shake large icon/UI packages so only used exports are bundled
    optimizePackageImports: [
      'lucide-react',
      'framer-motion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-dialog',
      '@radix-ui/react-label',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-radio-group',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-slider',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-tooltip',
    ],
  },
  // Vercel's serverless function bundler traces the module graph statically and can miss files
  // that are only ever touched via a runtime fs.readdirSync/readFileSync (src/lib/blog.ts reads
  // src/content/blog/*.md this way) — force-include the whole content dir so blog posts aren't
  // silently absent from the deployed bundle even though they build and run fine locally.
  outputFileTracingIncludes: {
    '/blog': ['./src/content/blog/**/*'],
    '/blog/[slug]': ['./src/content/blog/**/*'],
  },
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
      { protocol: 'https', hostname: 'coin-images.coingecko.com' },
      { protocol: 'https', hostname: 'near-intents.org' },
      { protocol: 'https', hostname: 'dd.dexscreener.com' },
      { protocol: 'https', hostname: 'ipfs.sintral.me' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
      { protocol: 'https', hostname: '*.giphy.com' },
      { protocol: 'https', hostname: 'media.giphy.com' },
      { protocol: 'https', hostname: 'i.giphy.com' },
      { protocol: 'https', hostname: 'm.media-amazon.com' },
      { protocol: 'https', hostname: 'assets.relay.link' },
      { protocol: 'https', hostname: '*.relay.link' },
      { protocol: 'https', hostname: 'home.privy.io' },
      { protocol: 'https', hostname: 'pbs.twimg.com' },
    ],
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      '@stripe/crypto': path.resolve(__dirname, 'empty-module.js'),
      '@farcaster/mini-app-solana': path.resolve(__dirname, 'empty-module.js'),
      // viem/ox tempo has a dynamic require() that pulls in every possible module
      'ox/_esm/tempo/internal/virtualMasterPool': path.resolve(__dirname, 'empty-module.js'),
    };
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /virtualMasterPool/ },
    ];
    return config;
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
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://unpkg.com https://*.spline.design https://*.splinetool.com https://va.vercel-scripts.com https://telegram.org https://*.posthog.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com https://cdn.fontshare.com",
              "img-src 'self' data: blob: https://raw.githubusercontent.com https://s2.coinmarketcap.com https://assets.coingecko.com https://coin-images.coingecko.com https://near-intents.org https://dd.dexscreener.com https://ipfs.sintral.me https://*.walletconnect.com https://*.spline.design https://*.splinetool.com https://*.supabase.co https://*.supabase.in https://api.qrserver.com https://*.giphy.com https://media.giphy.com https://i.giphy.com https://m.media-amazon.com https://assets.relay.link https://*.relay.link https://home.privy.io https://pbs.twimg.com https://*.paj.cash https://*.amazonaws.com",
              "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com https://cdn.fontshare.com https://api.fontshare.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://pay.blink.cash https://oauth.telegram.org blob:",
              "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://*.spline.design https://*.splinetool.com https://pay.blink.cash https://oauth.telegram.org",
              "connect-src 'self' https://auth.privy.io https://*.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://api.web3modal.com https://api.web3modal.org https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://1click.chaindefuser.com https://*.chaindefuser.com https://*.defuse.org https://*.near.org https://*.near-intents.org https://explorer.near-intents.org https://*.rhinestone.dev https://*.biconomy.io https://network.biconomy.io https://api.loom.com https://*.vercel-insights.com https://*.vercel-analytics.com https://react-tweet.vercel.app https://*.spline.design https://*.splinetool.com https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.fontshare.com https://api.fontshare.com https://*.supabase.co https://*.supabase.in https://mainnet.base.org https://eth.llamarpc.com https://*.llamarpc.com https://mainnet.optimism.io https://arb1.arbitrum.io https://*.arbitrum.io https://ipapi.co https://*.ipapi.co http://localhost:3001 https://*.up.railway.app https://*.railway.app https://api.giphy.com https://api.relay.link https://*.relay.link wss://*.relay.link https://tee.magicblock.app wss://tee.magicblock.app https://devnet-tee.magicblock.app wss://devnet-tee.magicblock.app https://devnet.magicblock.app wss://devnet.magicblock.app https://mainnet-tee.magicblock.app wss://mainnet-tee.magicblock.app https://payments.magicblock.app https://api.mainnet-beta.solana.com https://*.solana.com wss://*.solana.com wss://api.devnet.solana.com https://mainnet.helius-rpc.com https://*.helius-rpc.com wss://mainnet.helius-rpc.com wss://*.helius-rpc.com https://*.g.alchemy.com wss://*.g.alchemy.com https://quote-api.jup.ag https://*.jup.ag https://lite-api.jup.ag https://apple.com https://google.com https://*.moonpay.com https://api.moonpay.com https://pay.blink.cash https://api.blink.cash wss://pay.blink.cash https://api.zkp2p.xyz https://*.zkp2p.xyz https://open.er-api.com https://api.coingecko.com https://telegram.org https://oauth.telegram.org https://*.posthog.com",
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

export default withNextIntl(nextConfig);
