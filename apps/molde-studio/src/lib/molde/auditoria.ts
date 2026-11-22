// Auditoría de robustez de un molde sobre la capa OCR de una página.
//
// Objetivo (conversación "molde muy preciso"): que el día de mañana, en campo,
// el OCR NO lea una palabra de la ancla y el formato NO se descuadre. La
// auditoría corre la MISMA lógica que el motor universal (buscarAncla /
// resolverRectCampo) pero de forma aditiva y con simulaciones de fallo:
//
// 1. Verifica cada ancla contra el OCR real de la página de referencia
//    (encontrada / score / confianza de sus palabras / cuántas veces aparece).
// 2. SIMULA que la ancla desaparece (se quitan TODAS las líneas que la
//    matchean) y ve qué fuente usa el motor: respaldo o referencia.
// 3. SIMULA que ancla Y respaldo desaparecen: queda el rect de referencia
//    guardado (degradación controlada, el formato NO se descuadra) o null
//    (descuadre total — riesgo alto).
// 4. Sugiere un ANCLA DE RESPALDO cuando el campo no tiene: línea única en la
//    página, confianza alta, por encima del ancla, no usada por otro campo.
//
// La escalera de degradación del motor es:
//   ancla -> respaldo -> referencia (rect guardado, sin adaptación) -> null.
// El informe clasifica cada campo según qué tan profunda es la caída posible.

import type { CampoUniversal } from '@/lib/molde/universal-types';
import type { LineaOcr } from '@/lib/molde/types';
import {
  normTxt,
  editDistancePonderada,
  resolverRectCampo,
  ANCLA_SCORE_MIN,
} from '@/lib/molde/universal-engine';

export type NivelRiesgo = 'ok' | 'medio' | 'alto';

/** Sugerencia de ancla de respaldo para un campo sin respaldo. */
export interface RespaldoSugerido {
  texto: string;
  conf: number;
  /** Distancia vertical (0-1) entre la candidata y el ancla del campo. */
  distancia: number;
}

/** Informe de robustez de UN campo contra el OCR de la página auditada. */
export interface InformeCampo {
  id: string;
  etiqueta: string;
  tipo: string;
  estrategia: string;
  nivel: NivelRiesgo;
  /** Problemas legibles (vacío si ok). */
  problemas: string[];
  anclaTexto: string | null;
  /** El texto de la ancla PRIMARIA está presente en el OCR (score >= corte). */
  anclaEncontrada: boolean;
  /** Score del mejor match textual de la ancla (0-1), mismo corte del motor. */
  anclaScore: number | null;
  /** Confianza media (0-1) de las palabras del hit de la ancla. */
  anclaConf: number | null;
  /** Cuántas líneas de la página matchean el texto del ancla (1 = única). */
  ocurrencias: number;
  tieneRespaldo: boolean;
  /** Fuente que usa el motor HOY sobre la referencia (ancla/respaldo/…). */
  fuenteActual: 'ancla' | 'respaldo' | 'referencia' | 'fija' | null;
  /** Fuente del motor si la ancla desaparece (simulación 2). */
  simSinAncla: 'ancla' | 'respaldo' | 'referencia' | 'fija' | null;
  /** Fuente del motor si ancla Y respaldo desaparecen (simulación 3). */
  simSinAnclaYRespaldo: 'ancla' | 'respaldo' | 'referencia' | 'fija' | null;
  /** Ancla de respaldo sugerida (solo si !tieneRespaldo y hay candidata). */
  respaldoSugerido: RespaldoSugerido | null;
}

export interface InformePagina {
  pagina: number;
  nCampos: number;
  /** 0-100: 100 - 12*alto - 5*medio (clamp). Campos zona_fija cuentan como ok. */
  score: number;
  conteo: { ok: number; medio: number; alto: number };
  campos: InformeCampo[];
}

// ---- Internos ----

interface MatchLinea {
  score: number;
  /** bbox normalizado del mejor hit de esta línea. */
  rect: { x: number; y: number; w: number; h: number };
}

/** Ventanas deslizantes sobre las líneas, igual que buscarAncla pero SIN prior
 * de posición: devuelve las líneas cuyo mejor match alcanza el corte
 * ANCLA_SCORE_MIN (métrica de ambigüedad) con su mejor hit. Con `solo` se pasa
 * un subconjunto (p. ej. una única línea) para probar matches puntuales. */
function lineasQueMatchean(
  texto: string,
  lineas: LineaOcr[],
  w: number,
  h: number,
  solo?: LineaOcr[],
): MatchLinea[] {
  const objetivo = normTxt(texto);
  if (!objetivo) return [];
  const objetivoPals = objetivo.split(' ');
  const objetivoOrdenado = normTxt(
    [...objetivoPals].sort((a, b) => a.localeCompare(b)).join(' '),
  );
  const tol = Math.max(1, Math.floor(objetivo.length * 0.35));
  const fuente = solo ?? lineas;
  const out: MatchLinea[] = [];
  for (const l of fuente) {
    let mejor: MatchLinea | null = null;
    const palabras = l.palabras;
    for (let i = 0; i < palabras.length; i++) {
      for (let j = i; j < Math.min(palabras.length, i + objetivoPals.length + 1); j++) {
        const ventana = palabras.slice(i, j + 1);
        const frase = normTxt(ventana.map((p) => p.texto).join(' '));
        if (!frase) continue;
        let score = -1;
        const d = editDistancePonderada(objetivo, frase);
        if (d <= tol) score = 1 - d / objetivo.length;
        const fraseOrdenada = normTxt(
          ventana.map((p) => p.texto).sort((a, b) => a.localeCompare(b)).join(' '),
        );
        if (fraseOrdenada && score < 0.95) {
          const dOrd = editDistancePonderada(objetivoOrdenado, fraseOrdenada);
          if (dOrd <= tol) score = Math.max(score, (1 - dOrd / objetivo.length) * 0.95);
        }
        if (score < ANCLA_SCORE_MIN) continue;
        if (!mejor || score > mejor.score) {
          mejor = {
            score,
            rect: {
              x: palabras[i].bbox[0] / w,
              y: palabras[i].bbox[1] / h,
              w: (palabras[j].bbox[2] - palabras[i].bbox[0]) / w,
              h: (palabras[j].bbox[3] - palabras[i].bbox[1]) / h,
            },
          };
        }
      }
    }
    if (mejor) out.push(mejor);
  }
  return out;
}

/** Confianza media de las palabras cuyo centro cae dentro de un rect normalizado. */
function confEnRect(
  rect: { x: number; y: number; w: number; h: number },
  lineas: LineaOcr[],
): number | null {
  const confs: number[] = [];
  const margen = 0.002;
  const x1 = rect.x + rect.w + margen;
  const y1 = rect.y + rect.h + margen;
  for (const l of lineas) {
    for (const p of l.palabras) {
      const cx = (p.bbox[0] + p.bbox[2]) / 2;
      const cy = (p.bbox[1] + p.bbox[3]) / 2;
      if (cx < rect.x || cy < rect.y || cx > x1 || cy > y1) continue;
      if (p.conf >= 0) confs.push(p.conf);
    }
  }
  return confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
}

/** Mejor MatchLinea por score (o null). */
function mejorDe(ms: MatchLinea[]): MatchLinea | null {
  return ms.length ? ms.reduce((a, b) => (b.score > a.score ? b : a)) : null;
}

/** Sugiere la mejor línea como ancla de respaldo: única en la página, conf >= 0.8,
 * por encima del ancla, no usada por otro campo, y VALIDADA con la lógica de
 * producción: resolverRectCampo sobre las líneas sin la ancla primaria debe
 * devolver fuente 'respaldo'. Esto incluye el prior de posición de buscarAncla
 * (un respaldo demasiado lejos del rect esperado del ancla NO sirve — el motor
 * lo rechazaría igual en campo), así que solo se sugieren respaldos que
 * funcionan de verdad. Frase = primeras 4 palabras. */
function sugerirRespaldo(
  campo: CampoUniversal,
  cyRef: number,
  sinAncla: LineaOcr[],
  campos: CampoUniversal[],
  lineas: LineaOcr[],
  w: number,
  h: number,
): RespaldoSugerido | null {
  const usados = new Set<string>();
  for (const c of campos) {
    if (c.ancla?.texto) usados.add(normTxt(c.ancla.texto));
    if (c.ancla_respaldo) usados.add(normTxt(c.ancla_respaldo));
  }
  const candidatas: { frase: string; conf: number; distancia: number }[] = [];
  for (const l of lineas) {
    const confs = l.palabras.map((p) => p.conf).filter((c) => c >= 0);
    const conf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : -1;
    if (conf < 0.8) continue;
    const frase = l.palabras.slice(0, 4).map((p) => p.texto).join(' ').trim();
    if (frase.length < 4) continue;
    const clave = normTxt(frase);
    if (!clave || usados.has(clave)) continue;
    // Única en la página: que NINGUNA otra línea también la matchee.
    if (lineasQueMatchean(frase, lineas, w, h).length !== 1) continue;
    const cy = (l.bbox[1] + l.bbox[3]) / 2 / h;
    if (cy >= cyRef - 0.005) continue; // debe quedar por ENCIMA del ancla
    candidatas.push({ frase, conf, distancia: cyRef - cy });
  }
  // De la más cercana a la más lejana; valida con el motor de producción
  // (tope de 12 candidatas para acotar el costo de la auditoría).
  candidatas.sort((a, b) => a.distancia - b.distancia);
  for (const c of candidatas.slice(0, 12)) {
    const prueba: CampoUniversal = { ...campo, ancla_respaldo: c.frase };
    const r = resolverRectCampo(prueba, sinAncla, w, h);
    if (r && r.fuente === 'respaldo') {
      return { texto: c.frase, conf: c.conf, distancia: c.distancia };
    }
  }
  return null;
}

/** Audita los campos de UNA página contra su capa OCR. */
export function auditarCamposPagina(
  campos: CampoUniversal[],
  lineas: LineaOcr[],
  w: number,
  h: number,
  pagina: number,
): InformePagina {
  const informes: InformeCampo[] = campos.map((campo) => {
    const informe: InformeCampo = {
      id: campo.id,
      etiqueta: campo.etiqueta,
      tipo: campo.tipo,
      estrategia: campo.estrategia,
      nivel: 'ok',
      problemas: [],
      anclaTexto: campo.estrategia === 'ancla_relativa' ? campo.ancla?.texto ?? null : null,
      anclaEncontrada: false,
      anclaScore: null,
      anclaConf: null,
      ocurrencias: 0,
      tieneRespaldo: Boolean(campo.ancla_respaldo),
      fuenteActual: null,
      simSinAncla: null,
      simSinAnclaYRespaldo: null,
      respaldoSugerido: null,
    };

    if (campo.estrategia === 'zona_fija') {
      // No depende de OCR: se resuelve siempre con el rect absoluto del molde.
      informe.anclaEncontrada = true;
      informe.simSinAncla = 'fija';
      informe.simSinAnclaYRespaldo = 'fija';
      return informe;
    }

    const textoAncla = campo.ancla?.texto ?? '';
    if (!textoAncla) return informe;

    // 1) Estado actual: cómo resuelve el motor sobre la referencia.
    const resolucion = resolverRectCampo(campo, lineas, w, h);
    informe.fuenteActual = resolucion ? resolucion.fuente : null;

    // Presencia REAL del texto primario (sin prior de posición, corte del motor).
    const matchesAncla = lineasQueMatchean(textoAncla, lineas, w, h);
    informe.ocurrencias = matchesAncla.length;
    const mejorMatch = mejorDe(matchesAncla);
    informe.anclaEncontrada = mejorMatch !== null;
    informe.anclaScore = mejorMatch ? mejorMatch.score : null;
    informe.anclaConf = mejorMatch ? confEnRect(mejorMatch.rect, lineas) : null;

    // 2/3) Simulaciones de fallo: quitar las líneas que matchean cada texto.
    const quitarLineasDe = (textos: (string | undefined)[]): LineaOcr[] => {
      const vivos = textos.filter((t): t is string => Boolean(t));
      return lineas.filter((l) => !vivos.some((t) => lineasQueMatchean(t, lineas, w, h, [l]).length > 0));
    };
    const sinAncla = quitarLineasDe([textoAncla]);
    const r1 = resolverRectCampo(campo, sinAncla, w, h);
    informe.simSinAncla = r1 ? r1.fuente : null;

    const sinAmbas = quitarLineasDe([textoAncla, campo.ancla_respaldo]);
    const r2 = resolverRectCampo(campo, sinAmbas, w, h);
    informe.simSinAnclaYRespaldo = r2 ? r2.fuente : null;

    // 4) Sugerencia de respaldo (solo si el campo no lo tiene): candidatas
    //    cercanas y únicas, VALIDADAS con el motor sobre las líneas sin ancla.
    if (!informe.tieneRespaldo) {
      const cyRef = mejorMatch
        ? mejorMatch.rect.y + mejorMatch.rect.h / 2
        : campo.ancla?.rect
          ? campo.ancla.rect.y + campo.ancla.rect.h / 2
          : 0.5;
      informe.respaldoSugerido = sugerirRespaldo(campo, cyRef, sinAncla, campos, lineas, w, h);
    }

    // 5) Clasificación de riesgo según la escalera de degradación.
    const problemas = informe.problemas;
    let alto = false;
    if (!informe.anclaEncontrada) {
      alto = true;
      problemas.push('La ancla NO aparece en el OCR de la referencia (hoy resuelve por respaldo/referencia)');
    }
    if (informe.simSinAnclaYRespaldo === null) {
      alto = true;
      problemas.push('Si no se lee ancla ni respaldo, el campo NO se resuelve (descuadre total)');
    }
    if (!alto) {
      if (!informe.tieneRespaldo) {
        problemas.push('Sin ancla de respaldo: si el OCR no lee la ancla, degrada a la posición guardada (sin adaptación)');
      }
      if (informe.ocurrencias >= 2 && !(campo.desambiguadores && campo.desambiguadores.length)) {
        problemas.push(`Texto de ancla ambiguo: aparece ${informe.ocurrencias} veces en la página y no tiene desambiguadores`);
      }
      if (informe.anclaConf !== null && informe.anclaConf < 0.7) {
        problemas.push(`Ancla débil: confianza ${(informe.anclaConf * 100).toFixed(0)}% en la referencia (frágil en fotos de campo)`);
      }
    }
    informe.nivel = alto ? 'alto' : problemas.length ? 'medio' : 'ok';
    return informe;
  });

  const conteo = { ok: 0, medio: 0, alto: 0 };
  for (const c of informes) conteo[c.nivel] += 1;
  const score = Math.max(0, Math.min(100, 100 - 12 * conteo.alto - 5 * conteo.medio));
  return { pagina, nCampos: informes.length, score, conteo, campos: informes };
}
