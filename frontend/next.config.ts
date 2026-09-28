import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep isolated browser tests from sharing the running application's dev cache.
  distDir: process.env.NEXT_TEST_OUTPUT_DIR || ".next",
};

export default nextConfig;
