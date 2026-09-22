import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // The floor plan moved from House Operations to Patients & Admissions (2026-09-22).
  async redirects() {
    return [{ source: "/house-ops/floor-plan", destination: "/patients/floor-plan", permanent: true }];
  },
};

export default nextConfig;
