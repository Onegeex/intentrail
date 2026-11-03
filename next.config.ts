import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep server-only env off the client bundle
  env: {
    // Only expose non-sensitive public network label to the client
    NEXT_PUBLIC_NEAR_NETWORK:
      process.env.NEAR_NETWORK === "mainnet" &&
      process.env.ALLOW_MAINNET === "true"
        ? "mainnet"
        : "testnet",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "connect-src 'self' https://rpc.testnet.near.org https://rpc.mainnet.near.org https://1click.chaindefuser.com https://api.coingecko.com https://*.mynearwallet.com https://*.near.org wss://*.near.org",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
