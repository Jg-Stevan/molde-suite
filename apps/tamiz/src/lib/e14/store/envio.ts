/**
 * R-27 (H-17, auditoría 2026-11-16) — SLICE ENVÍO/ARCHIVO: el registro del
 * envío (registrarEnvio — punto único G.1), el título de la página en curso,
 * el archivado de huecos por mesa (Fase B §6) y las acciones de envío/
 * escalación/corrección de ubicación. Extraído de la ex tienda-dios:
 * registrarEnvio y tituloPaginaActual eran cierres del create — ahora son
 * funciones exportadas que reciben el set/get de la tienda (los slices
 * análisis/edición/captura las reutilizan SIN importar la fachada).
 */
import { getBridge } from "../get-bridge";
import { redActual } from "../obs/dispositivo";
import { sha256HexDeDataUrl } from "../hash";
import {
  claveDeMesa,
  claveDePuesto,
  tipoPaginaDe,
  tituloYUbicacionDe,
  type ClasificacionE14,
} from "@molde-suite/scanner-core/dominio/clasificador";
import { etiquetaFormulario } from "../checklist";
import type { HistorialRow } from "@molde-suite/scanner-core/dominio/types";
import { marcarPaginaOK, refrescarMesasDeArchivo } from "./guion";
import type { ActaArchivada, E14Get, E14Set, E14Store, HuecoArchivado, PuestoActual } from "./tipos";

/** FIX (auditoría 2-a #10): contador de ids de historial — dos filas creadas
 *  en el MISMO milisegundo (envío auto + escalación, ráfaga MASIVA)
 *  colisionaban como React keys. Mismo patrón del contador de construirActa. */
let contadorHistorial = 0;
/** Id de fila de historial — lo comparten los slices que estampan filas
 *  (captura: contingencia C4 · análisis: rechazo/cancelación/interrupción ·
 *  envío: registro y escalación). */
export function idHistorial(): string {
  return `h-${Date.now()}-${contadorHistorial++}`;
}

/**
 * Fase B (§6): archiva el hueco de una clasificación bajo su clave de mesa
 * (códigos con ceros, p. ej. «88-335-05-02-001»). Duplicado del MISMO hueco
 * → reemplaza (la clasificación más reciente queda como vigente) y avisa
 * (análisis §G.4.1). Idempotente: re-archivar el mismo acta es silencioso
 * para el llamador que ignora `duplicado`.
 * KIT actas-resumen-puesto-v2: además devuelve el PUESTO de la clasificación
 * (regla del mantenedor «solo un puesto» — la última archivada manda).
 */
function archivarHueco(
  archivadas: Record<string, ActaArchivada>,
  clasif: ClasificacionE14,
  /** KIT actas-vivas-paginas-v1 (FASE C): true → hueco RESCANEO (la
   *  captura archivada llegó ADVERTENCIA). */
  conRescate: boolean,
): { nuevas: Record<string, ActaArchivada>; duplicado: boolean; puesto: PuestoActual | null } {
  const clave = claveDeMesa(clasif);
  const tipo = clasif.tipo ? tipoPaginaDe(clasif.tipo) : null;
  const prefijo = claveDePuesto(clasif);
  if (!clave || !tipo || !prefijo)
    return { nuevas: archivadas, duplicado: false, puesto: null };
  // PUESTO ACTUAL (regla del mantenedor): la última clasificación archivada manda.
  const puesto: PuestoActual = {
    clave: prefijo,
    titulo: (clasif.puesto?.nombre || "PUESTO SIN NOMBRE").toUpperCase(),
    departamento: clasif.departamento?.nombre ?? "",
    municipio: clasif.municipio?.nombre ?? "",
    zona: clasif.zona?.codigo ?? "",
    puesto: clasif.puesto?.codigo ?? "",
  };
  // KIT actas-vivas-paginas-v1 (FASE B): la página del papel es DATO — si el
  // OCR/1D NO la leyó (pagina == null) el hueco va al PRIMER hueco LIBRE de
  // ese tipo (P1 libre → P1 · si no P2 libre → P2 · si no → P1, que
  // reemplaza — duplicado, semántica de hoy). NUNCA se asume P1 en silencio
  // (bug del mantenedor 16-oct: pág 2 de Frankfurt archivada en TRANSMISIÓN P1 →
  // la mesa 012 quedaba incompleta para siempre). Con página conocida →
  // exactamente igual que hoy.
  const previa = archivadas[clave];
  const paginaHueco: 1 | 2 = clasif.pagina
    ? clasif.pagina.index === 2
      ? 2
      : 1
    : (() => {
        const huecos = previa?.huecos ?? [];
        const ocupado = (p: 1 | 2) => huecos.some((h) => h.tipo === tipo && h.pagina === p);
        return !ocupado(1) ? 1 : !ocupado(2) ? 2 : 1;
      })();
  const hueco: HuecoArchivado = {
    tipo,
    pagina: paginaHueco,
    // KIT actas-vivas-paginas-v1 (FASE C): el hueco hereda el estado del
    // desenlace de la captura que se archiva; el re-archivo del mismo hueco
    // reemplaza clasificación Y estado (la más reciente manda — ya existía).
    estado: conRescate ? "RESCANEO" : "OK",
  };
  if (!previa) {
    return {
      nuevas: { ...archivadas, [clave]: { clasificacion: clasif, huecos: [hueco] } },
      duplicado: false,
      puesto,
    };
  }
  const yaEstaba = previa.huecos.some((h) => h.tipo === hueco.tipo && h.pagina === hueco.pagina);
  return {
    nuevas: {
      ...archivadas,
      [clave]: {
        // hueco duplicado → REEMPLAZA (§G.4.1): la foto más reciente gana el
        // hueco. FIX (auditoría 2-a C2): el re-archivo también reemplaza el
        // ESTADO del hueco (AC-RC5) — antes se conservaban previa.huecos
        // intactos y un RESCANEO ⚠ quedaba congelado para siempre (la mesa
        // jamás cerraba aunque el re-escaneo saliera ÓPTIMO).
        clasificacion: clasif,
        huecos: yaEstaba
          ? previa.huecos.map((h) =>
              h.tipo === hueco.tipo && h.pagina === hueco.pagina ? hueco : h,
            )
          : [...previa.huecos, hueco],
      },
    },
    duplicado: yaEstaba,
    puesto,
  };
}

/** C-08 — async: el hash REAL del acta (SHA-256 de la foto procesada) exige
 *  crypto.subtle. Los callers hacen await (analisisCompletado/enviarActa/
 *  aplicarRecorte/mejorarFotoActa) — el registro del envío sigue atómico
 *  para la UI porque el set ocurre al final. */
export async function registrarEnvio(
  set: E14Set,
  get: E14Get,
  tituloPagina: string,
): Promise<{ online: boolean; hora: string }> {
  const bridge = getBridge();
  const { online, historial, completadas, mesas, paginaObjetivo, actaActual, archivadas } = get();
  const actaFuente = actaActual;
  // §G.1 — ORDEN-WAVE3-add-envio-individual-v1 (obs-envio-individual-v1):
  // telemetría del envío INDIVIDUAL. t0 al ENTRAR (el costo del armado del
  // set — hash + archivarHueco incluido — es parte del envío observable).
  const t0 = performance.now();
  const hora = bridge.horaHistorial();
  const fila: HistorialRow = {
    id: idHistorial(),
    titulo: tituloPagina,
    // Bloque 2.6 — HONESTO: nada se transmite (sin hub); el documento se
    // GUARDA LOCALMENTE y queda exportable a PDF.
    estado: "GUARDADO_LOCAL",
    hora,
  };
  // Bloque 2.6 — SIN servidor: no hay cola falsa ni dicotomía online. El
  // hash SHA-256 REAL es integridad LOCAL de la evidencia (C-08 intacto:
  // jamás un relleno — doctrina sin-relleno).
  const colaOffline = 0;
  const hash = actaFuente?.fotoProcesada
    ? ((await sha256HexDeDataUrl(actaFuente.fotoProcesada)) ?? undefined)
    : undefined;

  // Libro de PDF de la sesión: JPEG DOWNSCALADO (≤1280, q0.8) del documento —
  // RAM acotada (tope FIFO 30). Nada de dataURLs de 12 MP (lección D23).
  const fotoLibro = actaFuente?.fotoProcesada
    ? await fotoParaLibro(actaFuente.fotoProcesada)
    : actaFuente?.fotoOriginal
      ? await fotoParaLibro(actaFuente.fotoOriginal)
      : null;
  const pdfLibro = [
    {
      id: fila.id,
      titulo: fila.titulo,
      estado: fila.estado,
      score: actaFuente?.score ?? null,
      hora,
      foto: fotoLibro,
      qr: actaFuente?.qrPayload ?? null,
    },
    ...get().pdfLibro,
  ].slice(0, 30);
  // KIT e14-sin-relleno-v1: conteo HONESTO de envíos reales (antes el cap
  // «Math.min(+1, asignadasHoy)» era herencia del seed demo 12/9 — con
  // asignadasHoy 0 congelaba el contador a cero para siempre).
  const mesasActualizadas = paginaObjetivo
    ? marcarPaginaOK(mesas, paginaObjetivo)
    : mesas;
  // Fase B (§6): acta con clasificación AUTO (gate o panel) → archiva su
  // hueco. Idempotente: si el panel ya la archivó, el reemplazo es
  // silencioso (mismo acta, mismos datos).
  let archivadasNuevas = archivadas;
  let puestoNuevo: PuestoActual | null = null;
  if (actaFuente?.clasificacion?.nivel === "AUTO") {
    const r = archivarHueco(
      archivadas,
      actaFuente.clasificacion,
      // KIT actas-vivas-paginas-v1 (FASE C): el estado del hueco lo pone el
      // desenlace de la captura que se archiva (ADVERTENCIA → RESCANEO).
      actaFuente.status === "ADVERTENCIA",
    );
    archivadasNuevas = r.nuevas;
    puestoNuevo = r.puesto;
  }
  set({
    historial: [fila, ...historial],
    pdfLibro,
    completadas: completadas + 1,
    colaOffline,
    mesas: mesasActualizadas,
    archivadas: archivadasNuevas,
    // PUESTO ACTUAL (kit actas-resumen-puesto-v2): el del archivo AUTO manda.
    puestoActual: puestoNuevo ?? get().puestoActual,
    actaActual:
      actaFuente === actaActual && actaActual
        ? {
            ...actaActual,
            hashSha256: hash,
            // §G.1 — envioMs SOLO flujo INDIVIDUAL (el envío SIEMPRE es
            // del actaActual). Regla de contrato: envioMs != null ⇔ había
            // red al enviar
            // (offline → SIN campo — null honesto, misma disciplina del
            // runner D61). El número ES el tiempo de registro local
            // (hash SHA-256 real incluido): cuando §A (ledger D1)
            // aterrice, el MISMO campo captura la latencia de red real.
            // §G.2 — la red del momento viaja en el MISMO parche
            // (envioRedTipo/envioDownlinkMbps — nulls honestos sin dato).
            ...(actaActual.diagnostico != null && online
              ? {
                  diagnostico: {
                    ...actaActual.diagnostico,
                    tiempos: {
                      ...actaActual.diagnostico.tiempos,
                      envioMs: Math.round(performance.now() - t0),
                    },
                    envioRedTipo: redActual()?.tipo ?? null,
                    envioDownlinkMbps: redActual()?.downlinkMbps ?? null,
                  },
                }
              : {}),
          }
        : actaActual,
  });
  // C-11 — el envío archivó hueco (AUTO) → el guion se RE-DERIVA del
  // archivo (fuente única): `mesas` deja de congelarse (H-18/N-02). Sin
  // hueco nuevo se conserva la marca inline de la página objetivo (sin
  // clasificación AUTO no hay hueco que derive).
  if (archivadasNuevas !== archivadas) refrescarMesasDeArchivo(set, get);
  return { online: true, hora }; // compat de firma — ya no hay red que consultar
}

export function tituloPaginaActual(get: E14Get): string {
  const { paginaObjetivo, actaActual } = get();
  // Fase B (§6): título de mesa REAL cuando la clasificación está resuelta.
  const c = actaActual?.clasificacion;
  if (c?.nivel === "AUTO" && c.puesto && c.mesa !== null && c.tipo) {
    // KIT actas-vivas-paginas-v1 (FASE B): página DESCONOCIDA → honesto
    // en el historial («PÁG ?»), NUNCA P1 mentiroso.
    const p = c.pagina == null ? "PÁG ?" : c.pagina.index === 1 ? "P1" : "P2";
    return `${c.puesto.nombre} · DOC ${c.mesa} — ${etiquetaFormulario(c.tipo)} ${p}`;
  }
  if (!paginaObjetivo) return "DOC 01 — PRINCIPAL P1";
  const p = paginaObjetivo.pagina === 1 ? "P1" : "P2";
  return `${paginaObjetivo.mesaId} — ${etiquetaFormulario(paginaObjetivo.tipo)} ${p}`;
}

/** Slice envío: estado inicial (jornada a cero — KIT e14-sin-relleno-v1) +
 *  acciones de envío/escalación/corrección. */
export function crearEnvio(
  set: E14Set,
  get: E14Get,
): Pick<
  E14Store,
  | "completadas"
  | "historial"
  | "colaOffline"
  | "solicitudesRescaneo"
  | "archivadas"
  | "puestoActual"
  | "enviarActa"
  | "escalarRevisionHumana"
  | "guardarUbicacion"
> {
  const bridge = getBridge();
  return {
    archivadas: {},
    puestoActual: null,
    completadas: 0,
    colaOffline: 0,
    solicitudesRescaneo: 0,
    historial: [],

    enviarActa: async () => {
      const { actaActual } = get();
      // D20 (L5) + G4 (KIT e14-gate-v2): envío MANUAL para ADVERTENCIA. La
      // ÓPTIMA ya no espera envío manual: el auto-envío D4 dispara al
      // capturar (analisisCompletado) Y tras el recorte (aplicarRecorte) —
      // el recorte es un flujo NORMAL: re-evalúa y, si pasa, auto-envía
      // como cualquier captura (sin banner ni CTA especial).
      if (
        !actaActual ||
        (actaActual.status !== "ADVERTENCIA" && actaActual.status !== "OPTIMA")
      ) {
        return;
      }
      await registrarEnvio(set, get, tituloPaginaActual(get));
      // Bloque 2.6 — HONESTO: el documento queda GUARDADO LOCALMENTE (su
      // status real no cambia — no hay servidor que lo reciba). El PDF va en
      // ACTAS/RESUMEN (botón PDF del libro de la sesión).
      set({
        vista: "revision",
      });
    },

    escalarRevisionHumana: () => {
      const acta = get().actaActual;
      // Guard del mantenedor: SOLO score intermedio (ADVERTENCIA) y bajo
      // (RECHAZADA). ENVIADA/OPTIMA/EN_RH: no-op.
      if (!acta || (acta.status !== "ADVERTENCIA" && acta.status !== "RECHAZADA")) return;
      const fila: HistorialRow = {
        id: idHistorial(),
        titulo: tituloPaginaActual(get),
        estado: "REVISION_HUMANA",
        hora: bridge.horaHistorial(),
      };
      set({
        actaActual: { ...acta, status: "EN_REVISION_HUMANA", intento: acta.maxIntentos },
        historial: [fila, ...get().historial],
      });
    },

    guardarUbicacion: (clasificacion) => {
      const { actaActual, archivadas } = get();
      if (!actaActual) return;
      // §5: la corrección del operador es AUTO-manual (confianza plena).
      const final: ClasificacionE14 = {
        ...clasificacion,
        nivel: "AUTO",
        confianzas: { departamento: 1, municipio: 1, puesto: 1, tipo: 1 },
      };
      const { nuevas, puesto } = archivarHueco(
        archivadas,
        final,
        // KIT actas-vivas-paginas-v1 (FASE C): el estado del acta corregida
        // manda (llegó ADVERTENCIA → hueco RESCANEO; re-archivo la sube a OK).
        actaActual.status === "ADVERTENCIA",
      );
      // §1.4 (SPEC-titulo-ubicacion): la corrección del panel también pasa el
      // título/ubicación al acta (AUTO-manual → el helper aplica).
      const titUbi = tituloYUbicacionDe(final);
      // §5: «pasa a flujo normal de envío (ADVERTENCIA-equivalente)» — la
      // foto era buena, la ubicación ya está corregida.
      set({
        actaActual: {
          ...actaActual,
          clasificacion: final,
          status: "ADVERTENCIA",
          ...(titUbi ? { titulo: titUbi.titulo, ubicacion: titUbi.ubicacion } : {}),
        },
        archivadas: nuevas,
        // PUESTO ACTUAL (kit actas-resumen-puesto-v2): la corrección del
        // panel TAMBIÉN manda (AUTO-manual → el puesto corregido es el actual).
        puestoActual: puesto ?? get().puestoActual,
      });
      // C-11 — el panel archivó hueco: el guion se RE-DERIVA del archivo
      // (antes `mesas` quedaba congelada hasta recargar — H-18/N-02).
      if (nuevas !== archivadas) refrescarMesasDeArchivo(set, get);
    },
  };
}

/** JPEG ≤1280 px para el libro de PDF (memoria acotada — nunca 12 MP). */
async function fotoParaLibro(dataUrl: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    if (!long) return null;
    const escala = Math.min(1, 1280 / long);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * escala));
    c.height = Math.max(1, Math.round(img.naturalHeight * escala));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  }
}
