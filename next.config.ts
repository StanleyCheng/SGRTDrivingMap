import type { NextConfig } from "next";

/**
 * GitHub Pages serves static files only, so the deploy build switches to a
 * static export: camera layers come from a baked snapshot and live images come
 * straight from the keyless data.gov.sg mirror (see src/lib/client-data.ts).
 */
const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.BASE_PATH ?? "/SGRTDrivingMap";

const nextConfig: NextConfig = {
  ...(staticExport && {
    output: "export" as const,
    basePath,
    assetPrefix: `${basePath}/`,
    images: { unoptimized: true },
    trailingSlash: true,
    env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_STATIC_MODE: "1" },
  }),
};

export default nextConfig;
