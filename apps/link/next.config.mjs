/** @type {import('next').NextConfig} */
const nextConfig = {
  // Minimal CSP for this app's actual dependencies only (Privy auth + our own backend API +
  // Solana RPC) — deliberately not copying apps/frontend's much broader CSP (Moonpay, Relay,
  // Giphy, WalletConnect, etc.), since this app doesn't use any of that.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://home.privy.io",
              "font-src 'self' data: https://fonts.gstatic.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "child-src https://auth.privy.io blob:",
              "frame-src https://auth.privy.io",
              "connect-src 'self' https://auth.privy.io https://*.privy.io https://*.rpc.privy.systems https://api.mainnet-beta.solana.com https://*.solana.com wss://*.solana.com https://mainnet.helius-rpc.com https://*.helius-rpc.com wss://*.helius-rpc.com",
              "worker-src 'self' blob:",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
