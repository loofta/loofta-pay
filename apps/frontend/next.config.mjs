import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import createNextIntlPlugin from 'next-intl/plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

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
    '@lightprotocol/hasher.rs',
  ],
  // Use `npm run dev` (webpack) for WASM (e.g. @lightprotocol/hasher.rs); `npm run dev:turbo` for Turbopack only
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
  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /hasher_wasm_simd_bg\.wasm/ },
      { module: /light_wasm_hasher_bg\.wasm/ },
      { module: /@splinetool/ },
    ];
    if (!isServer) {
      try {
        const hasherPath = path.dirname(require.resolve('@lightprotocol/hasher.rs/package.json'));
        const wasmSimdPath = path.resolve(hasherPath, 'dist/hasher_wasm_simd_bg.wasm');
        const wasmLightPath = path.resolve(hasherPath, 'dist/light_wasm_hasher_bg.wasm');
        const browserFatPath = path.resolve(hasherPath, 'dist/browser-fat/es');
        const fs = require('fs');
        const wasmSimdBrowserFat = path.resolve(browserFatPath, 'hasher_wasm_simd_bg.wasm');
        const wasmLightBrowserFat = path.resolve(browserFatPath, 'light_wasm_hasher_bg.wasm');
        let finalWasmSimd = null;
        let finalWasmLight = null;
        if (fs.existsSync(wasmSimdBrowserFat)) finalWasmSimd = wasmSimdBrowserFat;
        else if (fs.existsSync(wasmSimdPath)) finalWasmSimd = wasmSimdPath;
        if (fs.existsSync(wasmLightBrowserFat)) finalWasmLight = wasmLightBrowserFat;
        else if (fs.existsSync(wasmLightPath)) finalWasmLight = wasmLightPath;
        if (finalWasmSimd && finalWasmLight) {
          config.resolve.alias = {
            ...config.resolve.alias,
            'hasher_wasm_simd_bg.wasm': finalWasmSimd,
            'light_wasm_hasher_bg.wasm': finalWasmLight,
          };
        } else {
          console.warn('[Next.js] WASM files not found in @lightprotocol/hasher.rs (run npm install; postinstall copies them).');
        }
      } catch (e) {
        console.warn('[Next.js] @lightprotocol/hasher.rs not resolved:', e.message);
      }
    }
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
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://unpkg.com https://*.spline.design https://*.splinetool.com https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com https://cdn.fontshare.com",
              "img-src 'self' data: blob: https://raw.githubusercontent.com https://s2.coinmarketcap.com https://assets.coingecko.com https://near-intents.org https://dd.dexscreener.com https://ipfs.sintral.me https://*.walletconnect.com https://*.spline.design https://*.splinetool.com https://*.supabase.co https://*.supabase.in https://api.qrserver.com https://*.giphy.com https://media.giphy.com https://i.giphy.com https://m.media-amazon.com",
              "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com https://cdn.fontshare.com https://api.fontshare.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://pay.blink.cash blob:",
              "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://*.spline.design https://*.splinetool.com https://pay.blink.cash",
              "connect-src 'self' https://auth.privy.io https://*.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://api.web3modal.com https://api.web3modal.org https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://1click.chaindefuser.com https://*.chaindefuser.com https://*.defuse.org https://*.near.org https://*.near-intents.org https://explorer.near-intents.org https://*.rhinestone.dev https://*.biconomy.io https://network.biconomy.io https://api.loom.com https://*.vercel-insights.com https://*.vercel-analytics.com https://*.spline.design https://*.splinetool.com https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.fontshare.com https://api.fontshare.com https://mainnet.base.org https://eth.llamarpc.com https://*.llamarpc.com https://mainnet.optimism.io https://arb1.arbitrum.io https://*.arbitrum.io https://ipapi.co https://*.ipapi.co http://localhost:3001 https://*.up.railway.app https://*.railway.app https://api.giphy.com https://tee.magicblock.app wss://tee.magicblock.app https://devnet-tee.magicblock.app wss://devnet-tee.magicblock.app https://devnet.magicblock.app wss://devnet.magicblock.app https://mainnet-tee.magicblock.app wss://mainnet-tee.magicblock.app https://payments.magicblock.app https://api.mainnet-beta.solana.com https://*.solana.com wss://*.solana.com wss://api.devnet.solana.com https://mainnet.helius-rpc.com https://*.helius-rpc.com wss://mainnet.helius-rpc.com wss://*.helius-rpc.com https://*.g.alchemy.com wss://*.g.alchemy.com https://quote-api.jup.ag https://*.jup.ag https://lite-api.jup.ag https://apple.com https://google.com https://*.moonpay.com https://api.moonpay.com https://pay.blink.cash https://api.blink.cash wss://pay.blink.cash",
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
