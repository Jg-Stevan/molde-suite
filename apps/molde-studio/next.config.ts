import type { NextConfig } from "next";

// Modo estático (GitHub Pages): NEXT_PUBLIC_STATIC=1 activa `output: export`
// sin backend (sin /api, sin Prisma). NEXT_PUBLIC_BASE_PATH fija la ruta base
// del sitio publicada (p. ej. /molde-suite para jg-stevan.github.io/molde-suite).
// Sin esas variables el proyecto compila en modo servidor (standalone, sandbox).
const estatico = process.env.NEXT_PUBLIC_STATIC === "1";

// FASE 0 (blueprint DLA): el motor universal vive en packages/scanner-core
// (TS fuente, sin build previo) — transpilarlo como parte del app.
// PLAN-AGENTE-LAYOUT F2/F3: las señales ONNX (dla-onnx) y el evaluador de
// reglas estructurales (layout-core) también son TS fuente de workspace.
const transpile = ["@molde-suite/scanner-core", "@jg-stevan/dla-onnx", "@jg-stevan/layout-core"];

// Los paquetes de workspace leen process.env en runtime; Turbopack no los
// inlinea dentro de node_modules del workspace. `env` los fija en build para
// que `configuracionLista()` vea la misma URL que el servidor.
const dlaEnv = Object.fromEntries(
  [
    "NEXT_PUBLIC_DLA_MODELO_LAYOUT",
    "NEXT_PUBLIC_DLA_MODELO_CASILLAS",
    "NEXT_PUBLIC_DLA_MODELO_MANUSCRITO",
  ].flatMap((k) => (process.env[k] ? [[k, process.env[k] as string]] : [])),
) as Record<string, string>;

const nextConfig: NextConfig = estatico
  ? {
      transpilePackages: transpile,
      env: dlaEnv,
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
      env: dlaEnv,
      output: "standalone",
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    };

export default nextConfig;
