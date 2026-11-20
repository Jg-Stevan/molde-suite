/**
 * R-27 (H-17, auditoría 2026-11-16) — SLICE NAVEGACIÓN/CONEXIÓN: la vista
 * activa, el destello de captura del shell y el estado de red (con su
 * alternancia y el re-estampado del hash al volver online). Extraído de la
 * ex tienda-dios `src/lib/e14/store.ts` — mismo estado, mismas acciones,
 * cero cambio de comportamiento.
 */
import { sha256HexDeDataUrl } from "../hash";
import type { E14Get, E14Set, E14Store } from "./tipos";

/** Slice navegación: estado inicial + acciones de vista/conexión. */
export function crearNavegacion(
  set: E14Set,
  get: E14Get,
): Pick<
  E14Store,
  | "vista"
  | "vistaPrevia"
  | "destelloKey"
  | "online"
  | "navegar"
  | "destellar"
  | "alternarConexion"
> {
  return {
    vista: "escanear",
    vistaPrevia: null,
    destelloKey: 0,
    online: true,

    // MOCK 2026-11-16 (escaneo libre): la vista anterior se estampa SIEMPRE
    // que cambia el destino (guard: re-navegar a la MISMA vista no borra el
    // historial — p. ej. «Escanear documento» en el visor ya activo).
    navegar: (vista) =>
      set((s) => ({
        vista,
        vistaPrevia: s.vista === vista ? s.vistaPrevia : s.vista,
      })),

    destellar: () => set((s) => ({ destelloKey: s.destelloKey + 1 })),

    alternarConexion: () => {
      const { online, colaOffline, actaActual } = get();
      if (online) {
        set({ online: false });
        return;
      }
      set({ online: true });
      if (colaOffline > 0) {
        set({ colaOffline: 0 });
        // C-08 — al volver la red, el hash «EN COLA» se sustituye por el
        // SHA-256 REAL de la evidencia (jamás un relleno). Guard de
        // identidad: si el acta cambió mientras volaba el hash, no pisa.
        if (actaActual?.hashSha256 === "EN COLA") {
          const objetivo = actaActual;
          void (async () => {
            const hash = objetivo.fotoProcesada
              ? await sha256HexDeDataUrl(objetivo.fotoProcesada)
              : null;
            if (!hash) return;
            const actual = get().actaActual;
            if (actual !== objetivo || actual.hashSha256 !== "EN COLA") return;
            set({ actaActual: { ...actual, hashSha256: hash } });
          })().catch(() => {
            /* sin crypto.subtle → el campo queda «EN COLA» (honesto) */
          });
        }
      }
    },
  };
}
