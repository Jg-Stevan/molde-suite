import type { NextConfig } from "next";

// Modo estático (GitHub Pages): NEXT_PUBLIC_STATIC=1 activa `output: export`
// sin backend (sin /api, sin Prisma). NEXT_PUBLIC_BASE_PATH fija la ruta base
// del sitio publicada (p. ej. /molde-suite para jg-stevan.github.io/molde-suite).
// Sin esas variables el proyecto compila en modo servidor (standalone, sandbox).
const estatico = process.env.NEXT_PUBLIC_STATIC === "1";

// FASE 0 (blueprint DLA): el motor universal vive en packages/scanner-core
// (TS fuente, sin build previo) — transpilarlo como parte del app.
const transpile = ["@jg-stevan/scanner-core"];

const nextConfig: NextConfig = estatico
  ? {
      transpilePackages: transpile,
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
      transpilePackages: transpile,
      output: "standalone",
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    };

export default nextConfig;
