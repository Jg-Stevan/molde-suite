import type {
  CampoUniversal,
  MoldeUniversal,
  ResultadoCampoUniversal,
  ResultadoUniversal,
} from '@jg-stevan/scanner-core/molde/universal-types';
import type {
  CampoVeredicto,
  ResultadoGenerico,
  RolCampo,
  Veredicto,
} from './tipos';

/** Páginas que exige el molde: max(campo.pagina), mínimo 1. */
export function paginasEsperadas(molde: MoldeUniversal): number {
  return molde.campos.reduce((max, c) => Math.max(max, c.pagina), 1);
}

/**
 * Un obligatorio está "duro" cuando no hay dato posible en el papel:
 * página ausente, campo de tinta sin marca, zona vacía, o texto sin lectura
 * válida. La excepción honesta: un manuscrito (htr) con tinta pero sin OCR
 * legible NO es un faltante, es una revisión humana.
 */
export function esFaltanteDuro(
  r: ResultadoCampoUniversal,
  def: CampoUniversal,
): boolean {
  if (r.estado !== 'no_encontrado') return false;
  if (r.banderas.includes('pagina_faltante')) return true;
  if (def.tipo !== 'texto') return true;
  if (r.banderas.includes('zona_vacia')) return true;
  if (def.htr && r.banderas.includes('ocr_vacio')) {
    const ratio = typeof r.ratio === 'number' ? r.ratio : 0;
    if (ratio >= def.umbral * 0.6) return false;
  }
  return true;
}

/**
 * Regla de IDENTIDAD DE PÁGINA (plan técnico §4.7/§4.8).
 *
 * Los moldes del modo genérico marcan con `destacado: true` los campos de
 * IDENTIDAD impresa declarados por el plan ("Pág N de 6", "HOJA N° N DE 2",
 * títulos y anclas de identidad: e22 `articulo_3`…). Su patrón se evalúa
 * sobre el RECORTE de la posición esperada (OCR psm 7, fiable incluso cuando
 * el OCR de página completa fusiona cabeceras pequeñas).
 *
 * Si NINGÚN campo de identidad de la página cumplió su patrón, la hoja
 * capturada no corresponde a esa posición (intercambiada, duplicada o ajena)
 * → faltante duro → RECHAZADA. Si ALGUNO cumplió, la página es la correcta y
 * los patrones aislados que fallen quedan en REVISIÓN (ruido de OCR), nunca
 * rechazo — el criterio del plan: nunca RECHAZADA por falso faltante en
 * capturas completas y legibles.
 */
export function esCampoIdentidad(def: CampoUniversal): boolean {
  return (
    def.obligatorio === true &&
    def.tipo === 'texto' &&
    def.destacado === true &&
    typeof def.patron === 'string' &&
    def.patron.length > 0
  );
}

/**
 * Páginas capturadas SIN ningún campo de identidad cumplido: la identidad
 * impresa de la posición no apareció (página equivocada, duplicada o ajena).
 */
function paginasSinIdentidadDe(
  molde: MoldeUniversal,
  universal: ResultadoUniversal,
): Set<number> {
  const sinIdentidad = new Set<number>();
  for (const p of universal.paginas) {
    if (p.pagina <= 0) continue; // página sintética (faltante)
    const identidad = molde.campos.filter(
      (c) => c.pagina === p.pagina && esCampoIdentidad(c),
    );
    if (identidad.length === 0) continue;
    const leidos = p.campos.filter((r) => identidad.some((d) => d.id === r.id));
    if (
      leidos.length > 0 &&
      leidos.every((r) => r.estado !== 'ok')
    ) {
      sinIdentidad.add(p.pagina);
    }
  }
  return sinIdentidad;
}

function rolDe(
  def: CampoUniversal,
  r: ResultadoCampoUniversal,
  paginaSinIdentidad: boolean,
): RolCampo {
  if (!def.obligatorio) return 'informativo';
  if (esFaltanteDuro(r, def)) return 'faltante';
  if (esIdentidadFallida(r, def, paginaSinIdentidad)) return 'faltante';
  if (r.estado === 'requiere_revision') return 'revision';
  if (r.estado === 'no_encontrado') return 'revision'; // htr con tinta, sin OCR
  return 'ok';
}

/**
 * Campo de identidad sin NINGÚN patrón cumplido en su página: la hoja no
 * corresponde a esa posición (intercambiada, duplicada o de otro documento).
 */
export function esIdentidadFallida(
  r: ResultadoCampoUniversal,
  def: CampoUniversal,
  paginaSinIdentidad: boolean,
): boolean {
  if (!paginaSinIdentidad) return false;
  if (!esCampoIdentidad(def)) return false;
  if (r.banderas.includes('pagina_faltante')) return false;
  return r.estado !== 'ok';
}

function etiquetas(campos: CampoVeredicto[], max = 10): string {
  const nombres = campos.map((c) => c.etiqueta);
  if (nombres.length <= max) return nombres.join(', ');
  return `${nombres.slice(0, max).join(', ')} y ${nombres.length - max} más`;
}

/**
 * Convierte el resultado del motor en un veredicto de producto.
 *
 * Decisión clave: NO se usa `universal.obligatorios_faltantes` porque ese
 * arreglo incluye los campos en `requiere_revision`. Aquí se separa
 * faltante duro (rechaza) de revisión (advierte).
 */
export function calcularVeredicto(
  molde: MoldeUniversal,
  universal: ResultadoUniversal,
  paginasRecibidas: number,
): ResultadoGenerico {
  const esperadas = paginasEsperadas(molde);
  const defPorId = new Map(molde.campos.map((c) => [c.id, c]));
  const sinIdentidad = paginasSinIdentidadDe(molde, universal);

  const campos: CampoVeredicto[] = universal.paginas
    .flatMap((p) => p.campos)
    .map((r) => {
      const def = defPorId.get(r.id);
      const tipo = def?.tipo ?? r.tipo;
      const obligatorio = def?.obligatorio ?? false;
      const base: ResultadoCampoUniversal = r;
      return {
        id: r.id,
        etiqueta: r.etiqueta,
        pagina: r.pagina,
        tipo,
        obligatorio,
        estado: base.estado,
        valor: base.valor,
        ratio: typeof base.ratio === 'number' ? base.ratio : null,
        conf: base.conf,
        banderas: base.banderas,
        fuente: base.fuente,
        rect: base.rect,
        rol: def ? rolDe(def, base, sinIdentidad.has(r.pagina)) : 'informativo',
      } satisfies CampoVeredicto;
    });

  const faltantesDuros = campos.filter((c) => c.rol === 'faltante');
  const porRevisar = campos.filter((c) => c.rol === 'revision');
  const paginaEquivocada = campos.some((c) =>
    c.banderas.includes('posible_pagina_equivocada'),
  );
  const paginasNoIdentificadas = [...sinIdentidad].filter(
    (n) => n <= paginasRecibidas,
  );
  const paginasFaltantes: number[] = [];
  for (let n = 1; n <= esperadas; n++) {
    if (n > paginasRecibidas) paginasFaltantes.push(n);
  }

  let veredicto: Veredicto;
  if (
    paginasFaltantes.length > 0 ||
    faltantesDuros.length > 0 ||
    paginaEquivocada
  ) {
    veredicto = 'RECHAZADA';
  } else if (porRevisar.length > 0) {
    veredicto = 'ADVERTENCIA';
  } else {
    veredicto = 'OPTIMA';
  }

  const banderas = [...new Set(campos.flatMap((c) => c.banderas))].sort();
  const motivos: string[] = [];

  if (paginasFaltantes.length > 0) {
    motivos.push(
      `Faltan páginas: ${paginasFaltantes.join(', ')} de ${esperadas}. Captura todas las hojas del documento.`,
    );
  }
  if (paginaEquivocada) {
    motivos.push(
      'Una página no corresponde a la posición esperada. Revisa la identidad impresa de cada hoja (por ejemplo, "Pág 2 de 6" o "HOJA N° 2 DE 2").',
    );
  }
  if (paginasNoIdentificadas.length > 0) {
    motivos.push(
      `No se encontró la identidad impresa de la página ${paginasNoIdentificadas.join(', ')}: la hoja capturada no corresponde a esa posición (equivocada, duplicada o de otro documento).`,
    );
  }
  if (faltantesDuros.length > 0) {
    motivos.push(`Faltan obligatorios: ${etiquetas(faltantesDuros)}.`);
  }
  if (porRevisar.length > 0) {
    motivos.push(
      `Requieren revisión humana: ${etiquetas(porRevisar)} (manuscrito, confianza o patrón dudoso).`,
    );
  }

  const rotadas = [
    ...new Set(
      campos
        .filter((c) => c.banderas.includes('rotacion_180_corregida'))
        .map((c) => c.pagina)
        .filter((p) => p > 0),
    ),
  ];
  if (rotadas.length > 0) {
    motivos.push(
      `Corregidas automáticamente desde 180°: página(s) ${rotadas.join(', ')}.`,
    );
  }
  if (banderas.includes('validacion_fallida')) {
    motivos.push(
      'Una validación de cierre no cuadra; revisa los valores implicados.',
    );
  }
  if (
    campos.some((c) => c.obligatorio && c.banderas.includes('htr_manual'))
  ) {
    motivos.push(
      'El documento tiene campos manuscritos: la lectura debe confirmarla una persona.',
    );
  }

  const observaciones = campos.filter(
    (c) => !c.obligatorio && c.estado !== 'ok',
  );
  if (observaciones.length > 0) {
    motivos.push(
      `Observaciones en opcionales (no bloquean): ${etiquetas(observaciones, 6)}.`,
    );
  }

  if (veredicto === 'OPTIMA') {
    motivos.unshift('Documento completo y sin obligatorios pendientes.');
  } else if (veredicto === 'ADVERTENCIA') {
    motivos.unshift('Documento completo, con campos que requieren confirmación.');
  } else {
    motivos.unshift('Documento rechazado.');
  }

  return {
    molde: {
      nombre: molde.nombre,
      documento: molde.documento ?? '',
      version: molde.version,
    },
    veredicto,
    paginasEsperadas: esperadas,
    paginasRecibidas,
    paginasFaltantes,
    campos,
    faltantesDuros,
    porRevisar,
    motivos,
    banderas,
    universal,
  };
}
