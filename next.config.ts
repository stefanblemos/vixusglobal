import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // IR PDFs are sent to a Server Action; raise the default 1 MB body limit.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
