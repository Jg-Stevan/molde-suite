import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// KIT e14-remediacion-movil-v1 (D3 — #13 · P2): script inline del observer
// LCP/CLS — IIFE JS plano (sin imports) que corre en <head> ANTES de
// hidratar (requisito del plan: instalación temprana).
import { SCRIPT_LCP_CLS } from "@/lib/e14/obs/lcp-cls";
import { rutaPublica } from "@/lib/rutas";

/** Estructura (SPEC-e14-redesign-stitch §1): Inter (TODO el texto,
 *  400–800) + JetBrains Mono (scores, chips, códigos, horas, banner).
 *  Vía next/font/google — 0 peticiones a fonts.googleapis en runtime
 *  (AC12). El Caveat manuscrita del mock NO se porta (§1: la tarjeta
 *  muestra la FOTO del acta, no el formulario dibujado). */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const jbmono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

export const metadata: Metadata = {
  title: "Digitalizador de Documentos — Precisión documental",
  description:
    "Digitalizador de documentos: escaneo con score de calidad, verificación documental y envío verificado.",
  applicationName: "Digitalizador de Documentos",
  formatDetection: { telephone: false },
  // §12 PWA (SPEC-e14-cyber-neon): pantalla completa sin barras del
  // navegador — standalone + manifest (Next emite <link rel="manifest">).
  // F5 (PLAN-AGENTE-LAYOUT): public/manifest.webmanifest + SW offline-first
  // (public/sw.js). theme-color vive en `viewport.themeColor` (Next lo emite
  // como <meta name="theme-color">). Iconos SVG vectoriales del tamiz "T"
  // (sizes "any" — el navegador escala; sin PNG fantasma de 404).
  manifest: rutaPublica("/manifest.webmanifest"),
  icons: {
    icon: [
      { url: rutaPublica("/icon-192.svg"), type: "image/svg+xml", sizes: "any" },
      { url: rutaPublica("/icon-512.svg"), type: "image/svg+xml", sizes: "any" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Digitalizador de Documentos",
  },
};

export const viewport: Viewport = {
  themeColor: "#070A0D",
  width: "device-width",
  initialScale: 1,
  // Ola 4.1 (U2 — WCAG 1.4.4): maximumScale/userScalable ELIMINADOS — el
  // pinch-zoom del sistema vuelve a toda la app. El visor y el QuadEditor
  // gestionan sus gestos con `touch-none` local; el bloqueo global no
  // protegía nada que no estuviera ya protegido.
  // Sin viewport-fit=cover iOS no expone env(safe-area-*) (mismo patrón que scanner-lab).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/*
         * KIT e14-remediacion-movil-v1 (D3 — #13 · P2): LCP/CLS OBSERVABLES —
         * observer instalado ANTES de la carga. El LCP 14,7 s de campo llegó
         * SIN elemento por observer retrospectivo (element: null); esta IIFE
         * registra largest-contentful-paint + layout-shift con buffered:true
         * (recupera entradas previas), expone window.__e14LcpCls y despacha
         * "e14-lcp-cls". El lado TS (instalarObserverLcpCls en el bootstrap
         * del shell) publica el evento obs perf "obs:lcp-cls" al buffer.
         * try/catch total — silencioso si no hay PerformanceObserver.
         */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_LCP_CLS }} />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </head>
      <body
        className={`${inter.variable} ${jbmono.variable} antialiased bg-brand-black text-gray-100 font-sans`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
