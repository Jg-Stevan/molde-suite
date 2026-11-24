import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "off",
    // Patrones de refs-en-render pre-existentes de la capa UI original de Tamiz
    // (ScanView): fuera del alcance del plan (F5.3 cubre molde-studio).
    "react-hooks/refs": "off",
    "react-hooks/preserve-manual-memoization": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "@next/next/no-img-element": "off",
    "no-console": "off",
    "no-empty": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "next-env.d.ts"],
}, {
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    // Fase 3 (migración scanner-core): frontera pública del paquete.
    // apps/* consume por subpath del exports map (p. ej.
    // '@molde-suite/scanner-core/contract'), nunca rutas internas src/**.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@molde-suite/scanner-core/src/*"],
            message:
              "Usa la frontera pública: subpaths del exports map de @molde-suite/scanner-core (p. ej. './contract'), no rutas internas src/**.",
          },
        ],
      },
    ],
  }
}];

export default eslintConfig;
