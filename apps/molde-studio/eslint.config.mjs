import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  ignores: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "examples/**",
    "skills",
    // Assets de terceros generados/minificados (cores WASM de tesseract.js):
    // nunca se linteaban antes de auto-hospedarlos (P1 2026-11-21).
    "public/tesseract/**",
  ]
}, {
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    // Fase 3 (migración scanner-core): frontera pública del paquete.
    // apps/* consume por subpath del exports map (p. ej.
    // '@jg-stevan/scanner-core/contract'), nunca rutas internas src/**.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@jg-stevan/scanner-core/src/*"],
            message:
              "Usa la frontera pública: subpaths del exports map de @jg-stevan/scanner-core (p. ej. './contract'), no rutas internas src/**.",
          },
        ],
      },
    ],
  }
}];

export default eslintConfig;
