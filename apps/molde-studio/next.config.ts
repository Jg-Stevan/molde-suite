import type { NextConfig } from "next";

// Modo estático (GitHub Pages): NEXT_PUBLIC_STATIC=1 activa `output: export`
// sin backend (sin /api, sin Prisma). NEXT_PUBLIC_BASE_PATH fija la ruta base
// del sitio publicada (p. ej. /molde-suite para jg-stevan.github.io/molde-suite).
// Sin esas variables el proyecto compila en modo servidor (standalone, sandbox).
const estatico = process.env.NEXT_PUBLIC_STATIC === "1";

const nextConfig: NextConfig = estatico
  ? {
      output: "export",
      basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
      trailingSlash: true,
      images: { unoptimized: true },
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    }
  : {
      output: "standalone",
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    };

export default nextConfig;
