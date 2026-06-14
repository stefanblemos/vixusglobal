import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // IR PDFs (often scanned) are sent to a Server Action; raise the default 1 MB body limit.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
