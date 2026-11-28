// Tres desenlaces honestos para documentos regidos por un molde (plan §5).
//
// La pregunta que responde este módulo es SOLO una: cuando un obligatorio no
// quedó `ok`, ¿el motor puede AFIRMAR que el documento no lo trae, o solo no
// pudo localizarlo/leerlo con certeza? La diferencia manda el semáforo:
//   · ausencia comprobada o regla incumplida → RECHAZADA
//   · ubicación o lectura incierta          → EN_REVISION_HUMANA
//   · obligatorios verificados              → ADVERTENCIA u ÓPTIMA
//
// Criterio de AUSENCIA COMPROBADA (estricto, plan §5): el molde tiene que
// haber ENCONTRADO su ancla en este documento (`fuente='ancla'` con
// `ancla_rect`) Y la tinta medida de la zona tiene que ser CERO. Sin lectura
// con tinta presente —o con la zona puesta por layout sin hit de ancla— es un
// fallo del OCR/ubicación: eso es INCERTIDUMBRE, no «falta» («no afirmar que
// algo falta cuando no se localizó con certeza su zona»). Una página
// declarada por el molde que no se capturó sí es ausencia comprobada
// (`pagina_faltante`).
//
// Módulo PURO (tipos + strings): sin DOM, sin IndexedDB — lo consumen el
// veredicto (`enrutamiento`) y el banner (`ui/banner`).

import type { ResumenMoldeActa, ResumenMoldeCampo } from '@molde-suite/scanner-core/dominio/types';

export interface DesenlaceMolde {
  /** Obligatorios sin `ok` cuya AUSENCIA quedó comprobada. */
  ausentes: ResumenMoldeCampo[];
  /** Obligatorios sin `ok` y sin evidencia para afirmar ausencia (zona sin
   *  resolver, lectura dudosa). */
  inciertos: ResumenMoldeCampo[];
  /** Etiquetas sin fila propia que el motor declaró faltantes. */
  sinFila: string[];
  /** Etiquetas afectadas por una regla del molde que NO se cumple. */
  regla: string[];
}

/** ¿La zona quedó localizada por un hit REAL del ancla (no por layout)? */
export function anclaUbicada(c: ResumenMoldeCampo): boolean {
  return c.fuente === 'ancla' && c.ancla_rect != null;
}

export function ausenciaComprobada(c: ResumenMoldeCampo): boolean {
  if (c.estado !== 'no_encontrado') return false;
  if (c.banderas?.includes('pagina_faltante')) return true;
  // El OPERADOR vació el campo: su corrección es evidencia autoritativa
  // (conf=1) — el documento, tal como quedó, no lo trae.
  if (c.banderas?.includes('valor_editado_operador')) return true;
  // Ancla real + tinta medida cero: el papel no trae nada donde el molde dice
  // que debe estar. Cualquier otra combinación es incertidumbre.
  return anclaUbicada(c) && c.tinta === false;
}

/** Clasifica el resumen en los tres desenlaces. `null` = sin filas (camino
 *  viejo / host mínimo): el veredicto conserva el comportamiento histórico. */
export function clasificarDesenlace(r: ResumenMoldeActa | null | undefined): DesenlaceMolde | null {
  const filas = r?.campos;
  if (!filas) return null;
  const faltan = filas.filter((c) => c.obligatorio === true && c.estado !== 'ok');
  const presentes = new Set(filas.map((c) => c.etiqueta));
  return {
    ausentes: faltan.filter(ausenciaComprobada),
    inciertos: faltan.filter((c) => !ausenciaComprobada(c)),
    sinFila: (r?.obligatoriosFaltantes ?? []).filter((e) => !presentes.has(e)),
    regla: filas.filter((c) => c.banderas?.includes('validacion_fallida')).map((c) => c.etiqueta),
  };
}

/** Etiquetas únicas de los obligatorios sin verificar de forma segura
 *  (inciertos + sin fila), para el aviso al operador. `tope` para no reventar
 *  una línea de 412 px. */
export function etiquetasInseguras(d: DesenlaceMolde, tope = 3): string[] {
  const nombres = [...d.inciertos.map((c) => c.etiqueta), ...d.sinFila];
  return [...new Set(nombres)].slice(0, tope);
}
