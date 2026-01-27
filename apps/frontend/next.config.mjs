import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force webpack (not Turbopack) - required for Privacy Cash WASM support
  // Turbopack doesn't support WASM modules loaded via import.meta.url
  // Having a custom webpack function should force webpack usage
  // If Turbopack is still used, it means Next.js is ignoring the webpack config
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
  // Turbopack configuration (used in dev with --turbopack)
  // ⚠️ IMPORTANT: Privacy Cash requires webpack (not Turbopack) due to WASM support.
  // Use `npm run dev` (webpack) or `npm run dev:webpack` for development.
  // Use `npm run dev:turbo` only if you don't need Privacy Cash features.
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
    ],
  },
  webpack: (config, { isServer }) => {
    config.resolve.fallback = { 
      ...config.resolve.fallback,
      fs: false, 
      net: false, 
      tls: false 
    };
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    // Handle WASM files - make them optional to avoid build failures
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
      // Don't fail if WASM files are missing (they'll fail at runtime instead)
    });
    // Ignore missing WASM file resolution errors during build
    // These will be caught at runtime with helpful error messages
    // Add fallback for missing WASM files to prevent build errors
    config.resolve.fallback = {
      ...config.resolve.fallback,
      // Allow webpack to continue even if WASM files are missing
    };
    // Suppress module not found errors for WASM files
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /hasher_wasm_simd_bg\.wasm/ },
      { module: /light_wasm_hasher_bg\.wasm/ },
    ];
    config.resolve.alias = {
      ...config.resolve.alias,
      // Provide fallback for missing WASM files (will fail gracefully at runtime)
    };
    // Alias for WASM files to help with resolution
    // Handle missing WASM files gracefully - provide fallback paths
    if (!isServer) {
      try {
        const hasherPath = path.dirname(require.resolve('@lightprotocol/hasher.rs/package.json'));
        const wasmSimdPath = path.resolve(hasherPath, 'dist/hasher_wasm_simd_bg.wasm');
        const wasmLightPath = path.resolve(hasherPath, 'dist/light_wasm_hasher_bg.wasm');
        const browserFatPath = path.resolve(hasherPath, 'dist/browser-fat/es');
        
        const fs = require('fs');
        
        // Check browser-fat directory first (where postinstall copies them)
        const wasmSimdBrowserFat = path.resolve(browserFatPath, 'hasher_wasm_simd_bg.wasm');
        const wasmLightBrowserFat = path.resolve(browserFatPath, 'light_wasm_hasher_bg.wasm');
        
        // Use browser-fat files if they exist, otherwise try dist directory
        let finalWasmSimd = null;
        let finalWasmLight = null;
        
        if (fs.existsSync(wasmSimdBrowserFat)) {
          finalWasmSimd = wasmSimdBrowserFat;
        } else if (fs.existsSync(wasmSimdPath)) {
          finalWasmSimd = wasmSimdPath;
        }
        
        if (fs.existsSync(wasmLightBrowserFat)) {
          finalWasmLight = wasmLightBrowserFat;
        } else if (fs.existsSync(wasmLightPath)) {
          finalWasmLight = wasmLightPath;
        }
        
        if (finalWasmSimd && finalWasmLight) {
          config.resolve.alias = {
            ...config.resolve.alias,
            'hasher_wasm_simd_bg.wasm': finalWasmSimd,
            'light_wasm_hasher_bg.wasm': finalWasmLight,
          };
        } else {
          // WASM files not found - provide a fallback that won't break the build
          // The actual error will be handled at runtime
          console.warn('[Next.js Config] WASM files not found in @lightprotocol/hasher.rs.');
          console.warn('[Next.js Config] Privacy Cash features may not work. Files should be in:');
          console.warn(`  - ${wasmSimdPath}`);
          console.warn(`  - ${wasmLightPath}`);
          console.warn('[Next.js Config] Or in browser-fat directory after postinstall.');
          // Don't create aliases - let webpack handle the missing files gracefully
          // The module resolution will fail but won't break the build
        }
      } catch (e) {
        // Package might not be installed yet
        console.warn('[Next.js Config] Could not resolve @lightprotocol/hasher.rs paths:', e.message);
        console.warn('[Next.js Config] Privacy Cash features will not be available until package is properly installed.');
      }
    }
    // Suppress Spline critical dependency warnings
    config.ignoreWarnings = [
      { module: /@splinetool/ },
    ];
    return config;
  },
  // Suppress React hydration warnings from Privy (third-party library issue)
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
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
              // Images - self + data URIs + blob + external image sources + Spline + Supabase Storage + QR code generator + Giphy
              "img-src 'self' data: blob: https://raw.githubusercontent.com https://s2.coinmarketcap.com https://assets.coingecko.com https://near-intents.org https://dd.dexscreener.com https://ipfs.sintral.me https://*.walletconnect.com https://*.spline.design https://*.splinetool.com https://*.supabase.co https://*.supabase.in https://api.qrserver.com https://*.giphy.com https://media.giphy.com https://i.giphy.com",
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
              // API connections - Privy + WalletConnect + Web3Modal + your APIs + Spline + Fonts + RPC + Backend + Giphy + Solana + Helius + Privacy Cash
              "connect-src 'self' https://auth.privy.io https://*.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://api.web3modal.com https://api.web3modal.org https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://1click.chaindefuser.com https://*.chaindefuser.com https://*.defuse.org https://*.near.org https://*.near-intents.org https://explorer.near-intents.org https://*.rhinestone.dev https://*.biconomy.io https://network.biconomy.io https://api.loom.com https://*.vercel-insights.com https://*.vercel-analytics.com https://*.spline.design https://*.splinetool.com https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.fontshare.com https://api.fontshare.com https://mainnet.base.org https://eth.llamarpc.com https://*.llamarpc.com https://mainnet.optimism.io https://arb1.arbitrum.io https://*.arbitrum.io https://ipapi.co https://*.ipapi.co http://localhost:3001 https://*.up.railway.app https://*.railway.app https://api.giphy.com https://api.mainnet-beta.solana.com https://*.solana.com https://mainnet.helius-rpc.com https://*.helius-rpc.com https://api3.privacycash.org https://*.privacycash.org",
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
