import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Version skew protection: a tab from an older deploy does a full reload instead of mixing two builds.
  deploymentId: process.env.RENDER_GIT_COMMIT || undefined,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
