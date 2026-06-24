import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // IR PDFs (often scanned) are sent to a Server Action; raise the default 1 MB body limit.
    serverActions: { bodySizeLimit: "50mb" },
  },
  // Garante que a logo (lida via fs em runtime para os PDFs) seja empacotada nas funções.
  outputFileTracingIncludes: {
    "/api/**": ["./public/vixus-logo.png"],
    "/**": ["./public/vixus-logo.png"],
  },
  // Security headers (defense in depth for going online).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
