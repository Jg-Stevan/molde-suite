// Guion de la jornada: derivación de mesas desde lo archivado.

import type { Mesa } from '@molde-suite/scanner-core/dominio/types';
import type { PaginaObjetivo } from '@molde-suite/scanner-core/dominio/bridge';
import type { E14Get, E14Set } from './tipos';
import { mesasRealesDe } from '../jornada';

/** Marca la página objetivo como OK en la mesa correspondiente. */
export function marcarPaginaOK(mesas: Mesa[], pagina: PaginaObjetivo): Mesa[] {
  const numero = Number(pagina.mesaId.replace(/\D/g, '')) || 1;
  return mesas.map((m) => {
    if (m.id !== `DOC ${String(numero).padStart(2, '0')}`) return m;
    const paginas = m.paginas.map((p) =>
      p.tipo === pagina.tipo && p.pagina === pagina.pagina ? { ...p, estado: 'OK' as const } : p,
    );
    const ocupadas = paginas.filter((p) => p.estado === 'OK').length;
    return {
      ...m,
      paginas,
      estado: ocupadas === paginas.length ? ('COMPLETADA' as const) : ('EN_PROCESO' as const),
      progresoPct: Math.round((ocupadas / paginas.length) * 100),
    };
  });
}

/** Re-deriva `mesas` desde archivadas + puestoActual (tras cargar jornada). */
export function refrescarMesasDeArchivo(set: E14Set, get: E14Get): void {
  const { archivadas, puestoActual, paginaObjetivo } = get();
  const total = paginaObjetivo?.pagina === 2 ? 2 : null;
  const mesas = puestoActual ? mesasRealesDe(archivadas, puestoActual, total) : [];
  set({ mesas });
}
