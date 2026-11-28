'use client';

// AUTO (2026-11-27) — Catálogo de moldes EMPAQUETADOS que se siembra solo.
//
// El producto promete reconocer cualquier documento (`AGENTS.md`: «recibe
// documentos de cualquier tipo… reconoce automáticamente a qué molde
// pertenece»), pero la biblioteca IndexedDB empezaba VACÍA: los 8
// `.molde.json` de `public/moldes/` solo entraban si un humano los importaba a
// mano desde el Panel MOLDES. En el dispositivo de campo había 2 candidatos,
// así que un recibo real no tenía con qué identificarse.
//
// Este módulo siembra el catálogo una vez por versión:
//   · `tamiz.catalogoMoldes.v1` en localStorage = `CATALOGO_VERSION` sembrada.
//   · Un nombre YA presente en la biblioteca NUNCA se pisa: el molde que el
//     operador calibró e importó gana sobre el empaquetado.
//   · `variantes/` y `prueba_2paginas` quedan FUERA a propósito: las variantes
//     A/B/C empatan en ratio de anclas (mismo papel impreso) y el router
//     elegiría a ciegas — ver `public/moldes/LEEME.md`.
//
// Cero dependencias nuevas: fetch + la API cruda de IndexedDB de `almacen.ts`.

import {
  esMoldeUniversal,
  erroresMolde,
} from '@molde-suite/scanner-core/molde/universal-types';
import { sha256HexDeTexto } from '@molde-suite/scanner-core/core/hash';
import { BASE_PATH } from '../../rutas';
import { logger } from '../../logger';
import { guardarMolde, listarMoldes } from './almacen';

/**
 * BUMP MANUAL: súbelo cuando cambie un `.molde.json` de `public/moldes/` para
 * que los dispositivos vuelvan a sembrar. No se siembra por fecha ni por hash
 * de build — el costo de un bump olvidado es bajo (un fetch por molde), el de
 * sembrar en cada escaneo es red y latencia en el flujo de campo.
 */
export const CATALOGO_VERSION = 1;

const CLAVE_MARCA = 'tamiz.catalogoMoldes.v1';

/** Moldes de referencia empaquetados en `apps/tamiz/public/moldes/`. */
export const CATALOGO_NOMBRES = [
  'recibo_pago',
  'recibo_real',
  'comprobante_entrega',
  'comprobante_real',
  'e14_acta',
  'e22_resolucion',
  'e24_cuadro',
  'e26_acta_parcial',
] as const;

export interface DecisionSiembra {
  /** ¿Hace falta tocar la red? (falso = catálogo ya aplicado en el dispositivo) */
  falta: boolean;
  /** Nombres del catálogo que aún NO están en la biblioteca. */
  nombres: string[];
}

/**
 * Decisión PURA (sin `window`, sin IndexedDB, sin fetch) — el criterio de
 * siembra se prueba aquí y la capa de I/O de abajo no tiene lógica.
 *
 * @param marcaGuardada valor de `tamiz.catalogoMoldes.v1` (null si nunca se sembró)
 * @param nombres lista del catálogo (`CATALOGO_NOMBRES`)
 * @param existentes nombres ya presentes en la biblioteca IndexedDB
 */
export function decidirSiembra(
  marcaGuardada: string | null,
  nombres: readonly string[],
  existentes: readonly string[],
): DecisionSiembra {
  if (marcaGuardada === String(CATALOGO_VERSION)) return { falta: false, nombres: [] };
  const tienen = new Set(existentes);
  return { falta: true, nombres: nombres.filter((n) => !tienen.has(n)) };
}

export interface ResultadoSiembra {
  sembrados: string[];
  /** Nombres ya presentes (el molde del operador manda) o sin cambios. */
  omitidos: string[];
  errores: string[];
  /** Catálogo ya aplicado en el dispositivo (no se tocó la red). */
  intocada: boolean;
}

async function leerMarca(): Promise<string | null> {
  try {
    return window.localStorage.getItem(CLAVE_MARCA);
  } catch {
    return null;
  }
}

/**
 * URL de un molde empaquetado (respeta el prefijo de despliegue). El `?v=` es
 * la clave del cache-first del service worker (`/moldes/` en `esEstatico`):
 * el nombre de archivo es estable, así que sin versión un dispositivo que
 * sembró una plantilla vieja no vería nunca la recalibrada.
 */
export function urlDelMolde(nombre: string): string {
  return `${BASE_PATH}/moldes/${nombre}.molde.json?v=${CATALOGO_VERSION}`;
}

/**
 * Siembra el catálogo empaquetado en la biblioteca. NUNCA lanza: si la red
 * falla, IndexedDB no está disponible o un JSON viene malformado, se registra
 * el error y el escaneo sigue con lo que haya (comportamiento de siempre).
 */
export async function sembrarCatalogo(): Promise<ResultadoSiembra> {
  const resultado: ResultadoSiembra = { sembrados: [], omitidos: [], errores: [], intocada: false };
  if (typeof window === 'undefined') return resultado;
  let decision: DecisionSiembra;
  try {
    const filas = await listarMoldes();
    decision = decidirSiembra(await leerMarca(), CATALOGO_NOMBRES, filas.map((f) => f.nombre));
    resultado.omitidos = CATALOGO_NOMBRES.filter((n) => filas.some((f) => f.nombre === n));
  } catch (e) {
    logger.warn('[catalogo] biblioteca legible no disponible', { mensaje: (e as Error).message });
    return resultado;
  }
  if (!decision.falta) {
    resultado.intocada = true;
    return resultado;
  }
  if (decision.nombres.length === 0) {
    // Todo el catálogo ya está (el operador lo importó o se sembró y luego se
    // borró alguno): basta con sellar la marca para no volver a la red.
    await sellar();
    return resultado;
  }

  for (const nombre of decision.nombres) {
    try {
      const respuesta = await fetch(urlDelMolde(nombre));
      if (!respuesta.ok) {
        resultado.errores.push(`${nombre}: HTTP ${respuesta.status}`);
        continue;
      }
      const texto = await respuesta.text();
      const molde: unknown = JSON.parse(texto);
      if (!esMoldeUniversal(molde)) {
        resultado.errores.push(`${nombre}: ${erroresMolde(molde).join('; ')}`);
        continue;
      }
      // `idDe` (almacen.ts) sin checksum genera id con Date.now() → cada
      // arranque duplicaría la fila. El hash del texto crudo hace el id
      // determinista por contenido. Sin crypto.subtle (contexto inseguro) se
      // usa una semilla estable por nombre+versión: sigue sin duplicar.
      const checksum = (await sha256HexDeTexto(texto)) ?? `cat-v${CATALOGO_VERSION}-${nombre}-${molde.version}`;
      await guardarMolde(molde, checksum);
      resultado.sembrados.push(nombre);
    } catch (e) {
      resultado.errores.push(`${nombre}: ${(e as Error).message}`);
    }
  }

  logger.info('[catalogo] siembra de moldes empaquetados', {
    version: CATALOGO_VERSION,
    sembrados: resultado.sembrados,
    errores: resultado.errores,
  });
  // La marca SOLO se sella si no quedó ningún hueco: con errores se reintenta
  // en el siguiente escaneo (offline: `public/sw.js` responde 504 y acá se
  // registra el error — la biblioteca queda con lo que ya hubiera).
  if (resultado.errores.length === 0) await sellar();
  return resultado;
}

async function sellar(): Promise<void> {
  try {
    window.localStorage.setItem(CLAVE_MARCA, String(CATALOGO_VERSION));
  } catch {
    /* sin localStorage: la siembra se repite, best-effort */
  }
}
