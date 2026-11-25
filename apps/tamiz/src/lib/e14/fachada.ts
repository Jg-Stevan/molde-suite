// Fachada de la librería e14: LO ÚNICO que importan los componentes de UI.
// Re-exporta el contrato (scanner-core) + los helpers de presentación.

import type { Acta, ActaStatus, EtapaAnalisis, FuenteCaptura, HistorialRow, ProgresoAnalisis } from '@molde-suite/scanner-core/dominio/types';
import type { ClasificacionE14, DivipolRef } from '@molde-suite/scanner-core/dominio/clasificador';
import type { Quad } from '@molde-suite/scanner-core/core/types';
import { defaultQuad } from '@molde-suite/scanner-core/core/types';
import {
  ErrorRescateHeic,
  fileToCaptureDataUrl,
  jpegDimensionsFromBlob,
} from '@molde-suite/scanner-core/core/image-processor';
import { detectarQuadDeFoto } from './bridge/deteccion-quad';
import { getBridge } from './get-bridge';
import { esperarWorkerCaliente } from './bridge/captura';

export type { Acta, ActaStatus, EtapaAnalisis, FuenteCaptura, HistorialRow, ProgresoAnalisis, ClasificacionE14, Quad };

export type TipoCopia = 'TRANSMISION' | 'DELEGADOS';

export { defaultQuad, getBridge };

export type Point = Quad[number];

/** loadImage (contrato upstream del QuadEditor): decodifica un data URL. */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  return img.decode().then(() => img);
}

export { ErrorRescateHeic, fileToCaptureDataUrl, jpegDimensionsFromBlob };

/** detectDocumentEdges (contrato upstream): quad del detector sobre la foto.
 *  Usa el MISMO detector del visor en vivo (worker OpenCV); la heurística
 *  Sobel del core queda solo como respaldo si el worker no está. */
export function detectDocumentEdges(foto: string): Promise<Quad> {
  return detectarQuadDeFoto(foto).then((d) => d.quad);
}

/** Precalienta el motor de procesado (warm-up del canvas/worker). */
export function warmUpScannerWorker(): void {
  // D19 — warm-up del worker OpenCV REAL (public/scanner/detection-worker.js
  // vía detector-client del fork). Sin worker listo, detectDocumentEdges cae
  // a su detector Sobel local (contrato del cliente — null honesto).
  void import('@molde-suite/scanner-core/core/detector-client').then((m) => m.warmUpScannerWorker());
}

/** Nombre de archivo de exportación desde la clasificación. */
export function nombreExportacion(c: ClasificacionE14): string {
  const dep = c.departamento?.codigo ?? 'xx';
  const mun = c.municipio?.codigo ?? 'xxx';
  const mesa = c.mesa !== null ? String(c.mesa).padStart(3, '0') : 'xxx';
  const tipo = c.tipo === 'TRANSMISION' ? 'principal' : c.tipo === 'DELEGADOS' ? 'anexo' : 'doc';
  const pag = c.pagina ? `-p${c.pagina.index}` : '';
  return `acta-${dep}-${mun}-${mesa}-${tipo}${pag}.jpg`;
}

// ---- Divipol (catálogo de demostración del flujo E-14 EXTERIOR) ----
// Estructura: base[dep] = { n: nombre, m: { [mun]: { n, z: { [zon]: { n, p: { [std]: { n, mesas } } } } } } }.

export interface DivipolBase {
  [dep: string]: {
    n: string;
    m: {
      [mun: string]: {
        n: string;
        z: {
          [zon: string]: {
            n: string;
            p: {
              [std: string]: { n: string; mesas: number };
            };
          };
        };
      };
    };
  };
}

/** Catálogo mínimo de consulados de demostración (el real vive en Divipol oficial). */
const BASE_DEMO: DivipolBase = {
  '88': {
    n: 'NAIROBI',
    m: {
      '335': {
        n: 'KENIA',
        z: {
          '05': {
            n: 'ZONA 05',
            p: {
              '02': { n: 'PUESTO 02', mesas: 2 },
            },
          },
        },
      },
    },
  },
  '17': {
    n: 'EL CAIRO',
    m: {
      '212': {
        n: 'EGIPTO',
        z: {
          '03': {
            n: 'ZONA 03',
            p: {
              '01': { n: 'PUESTO 01', mesas: 2 },
            },
          },
        },
      },
    },
  },
  '23': {
    n: 'BARCELONA',
    m: {
      '108': {
        n: 'ESPAÑA',
        z: {
          '01': {
            n: 'ZONA 01',
            p: {
              '04': { n: 'PUESTO 04', mesas: 2 },
            },
          },
        },
      },
    },
  },
};

let estado: 'no-cargado' | 'listo' | 'fallo' = 'no-cargado';
let cacheBase: DivipolBase | null = null;

/** Carga el catálogo Divipol (idempotente). Hoy: catálogo de demo incluido. */
export async function cargarDivipol(): Promise<DivipolBase | null> {
  if (cacheBase) return cacheBase;
  cacheBase = BASE_DEMO;
  estado = 'listo';
  return cacheBase;
}

export function estadoDivipol(): 'no-cargado' | 'listo' | 'fallo' {
  return estado;
}

export function departamentosDe(base: DivipolBase): DivipolRef[] {
  return Object.entries(base).map(([codigo, d]) => ({ codigo, nombre: d.n }));
}

export function municipiosDe(base: DivipolBase, dep: string): DivipolRef[] {
  const d = base[dep];
  if (!d) return [];
  return Object.entries(d.m).map(([codigo, m]) => ({ codigo, nombre: m.n }));
}

export function zonasDe(base: DivipolBase, dep: string, mun: string): DivipolRef[] {
  const m = base[dep]?.m?.[mun];
  if (!m) return [];
  return Object.entries(m.z).map(([codigo, z]) => ({ codigo, nombre: z.n }));
}

export function puestosDe(base: DivipolBase, dep: string, mun: string, zon: string): Array<DivipolRef & { mesas: number }> {
  const z = base[dep]?.m?.[mun]?.z?.[zon];
  if (!z) return [];
  return Object.entries(z.p).map(([codigo, p]) => ({ codigo, nombre: p.n, mesas: p.mesas }));
}
