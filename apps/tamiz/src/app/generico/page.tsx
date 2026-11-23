'use client';

/**
 * MODO GENÉRICO — FLUJO GUIADO MULTIPÁGINA (2026-11-23).
 *
 * Rediseño del flujo según los mockups del mantenedor, con las DECISIONES
 * CERRADAS aplicadas: la piel sigue siendo «digielec» (tokens brand, SIN
 * glows ni mono total — los mockups solo aportan estructura/flujo); la
 * miniatura muestra la FOTO REAL procesada (nunca un formulario dibujado).
 *
 * Flujo (mock 1 → mock 2):
 *  1. Captura de la página 1 (cámara / simulación / archivo).
 *  2. RECONOCIMIENTO AUTOMÁTICO de plantilla (huella vs banda OCR) con
 *     fallback honesto a selección manual (decisión #5, Fase 6).
 *  3. Verificación POR PÁGINA (tarjeta «VERIFICACIÓN PÁGINA N» + score
 *     X.X/10 del mantenedor, decisión #1/#2) con foto procesada.
 *  4. PROGRESO DE DIGITALIZACIÓN (chips PÁG 1..N) + «ACCIÓN REQUERIDA» +
 *     CTA «ESCANEAR PÁGINA N+1».
 *  5. Al completar: verificación universal final + veredicto global +
 *     «DOCUMENTO GUARDADO AUTOMÁTICAMENTE» con hora (IndexedDB local,
 *     decisión #6) + historial reciente.
 *  El botón circular ✓ de la barra es DECORATIVO (solo estado, decisión #7).
 *
 * La lógica del motor sigue intacta: evaluarCapturas → veredicto.ts
 * (misma regla ÓPTIMA/ADVERTENCIA/RECHAZADA) y nada sale del dispositivo.
 */

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';
import {
  MOLDES_INCLUIDOS,
  PROBLEMAS_MOLDES,
} from '@/lib/generico/moldes-incluidos';
import { paginasEsperadas } from '@/lib/generico/veredicto';
import { evaluarCapturas } from '@/lib/generico/evaluar';
import {
  identificarMolde,
} from '@/lib/generico/reconocer';
import {
  palabraDeScore,
  verificarPagina,
  type VerificacionPagina,
} from '@/lib/generico/verificar-pagina';
import {
  dibujarPaginaSimulada,
} from '@/lib/generico/simulacion';
import {
  guardarEnHistorial,
  horaDeGuardado,
  listarHistorial,
  type FilaHistorial,
} from '@/lib/generico/historial';
import type {
  CampoVeredicto,
  ResultadoGenerico,
  Veredicto,
} from '@/lib/generico/tipos';
import { StitchArrowLeftIcon, StitchEyeIcon } from '@/components/e14/icons';

type Fase = 'inicio' | 'guiada' | 'analizando' | 'resultado';
type EstadoRecon = 'pendiente' | 'identificando' | 'reconocida' | 'manual' | 'fallo';

interface Foto {
  id: string;
  dataUrl: string;
}

function idLocal(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function leerArchivoComoDataUrl(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(lector.error ?? new Error('Lectura fallida'));
    lector.readAsDataURL(archivo);
  });
}

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'molde';
}

const TONO_VEREDICTO: Record<
  Veredicto,
  { caja: string; titulo: string; punto: string; etiqueta: string }
> = {
  OPTIMA: {
    caja: 'border-[#10b981]/40 bg-[#10b981]/10',
    titulo: 'text-[#10b981]',
    punto: 'bg-[#10b981]',
    etiqueta: 'ÓPTIMA',
  },
  ADVERTENCIA: {
    caja: 'border-amber-500/50 bg-amber-500/10',
    titulo: 'text-amber-300',
    punto: 'bg-amber-400',
    etiqueta: 'ADVERTENCIA',
  },
  RECHAZADA: {
    caja: 'border-red-500/50 bg-red-500/10',
    titulo: 'text-[#E52222]',
    punto: 'bg-[#E52222]',
    etiqueta: 'RECHAZADA',
  },
};

/** Píldora sólida del score (misma piel que la píldora flotante de REVISIÓN). */
const TONO_PILDORA: Record<'ok' | 'alerta' | 'fallo', string> = {
  ok: 'bg-[#10b981] text-[#090d12]',
  alerta: 'bg-[#f59e0b] text-[#090d12]',
  fallo: 'bg-[#ef4444] text-white',
};

const TONO_ITEM: Record<'ok' | 'alerta' | 'fallo', string> = {
  ok: 'text-[#10b981]',
  alerta: 'text-amber-400',
  fallo: 'text-[#E52222]',
};

const GLIFO: Record<'ok' | 'alerta' | 'fallo', string> = { ok: '✓', alerta: '•', fallo: '✗' };

const ROL_CAMPO: Record<
  CampoVeredicto['rol'],
  { chip: string; texto: string }
> = {
  ok: { chip: 'bg-[#10b981]/15 text-[#10b981]', texto: 'OK' },
  faltante: { chip: 'bg-red-500/15 text-[#E52222]', texto: 'FALTANTE' },
  revision: { chip: 'bg-amber-500/15 text-amber-300', texto: 'REVISAR' },
  informativo: { chip: 'bg-slate-500/15 text-slate-400', texto: 'OPCIONAL' },
};

const ESTADO_CAMPO: Record<CampoVeredicto['estado'], string> = {
  ok: 'Leído',
  no_encontrado: 'No encontrado',
  requiere_revision: 'Requiere revisión',
};

function valorVisible(campo: CampoVeredicto): string {
  if (campo.valor === true) return 'Presente';
  if (campo.valor === false) return 'Ausente';
  if (campo.valor === null || campo.valor === undefined) return '—';
  const texto = String(campo.valor).replace(/\s+/g, ' ').trim();
  return texto || '—';
}

function guardarArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function descargarReporte(
  resultado: ResultadoGenerico,
  alFallar: (reporte: { nombre: string; json: string; aviso: string }) => void,
): void {
  const fecha = new Date();
  const puntos = resultado.campos.map((c) => ({
    id: c.id,
    etiqueta: c.etiqueta,
    pagina: c.pagina,
    tipo: c.tipo,
    obligatorio: c.obligatorio,
    estado: c.estado,
    rol: c.rol,
    valor: c.valor,
    ratio: c.ratio,
    conf: c.conf,
    banderas: c.banderas,
    fuente: c.fuente,
    rect: c.rect,
  }));
  const reporte = {
    generado: fecha.toISOString(),
    app: 'tamiz-generico',
    molde: resultado.molde,
    veredicto: resultado.veredicto,
    paginas_esperadas: resultado.paginasEsperadas,
    paginas_recibidas: resultado.paginasRecibidas,
    paginas_faltantes: resultado.paginasFaltantes,
    motivos: resultado.motivos,
    banderas: resultado.banderas,
    faltantes_duros: resultado.faltantesDuros.map((c) => c.id),
    por_revisar: resultado.porRevisar.map((c) => c.id),
    campos: puntos,
    metricas: {
      total: resultado.universal.total,
      ok: resultado.universal.ok_count,
      score: resultado.universal.score,
      tiempos: resultado.universal.tiempos,
    },
  };
  const json = JSON.stringify(reporte, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const nombre = `reporte-${slug(resultado.molde.nombre)}-${fecha
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-')}.json`;
  const esMovil = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (esMovil) {
    if (typeof navigator.share === 'function') {
      const archivo = new File([blob], nombre, { type: 'application/json' });
      if (navigator.canShare?.({ files: [archivo] })) {
        navigator.share({ files: [archivo], title: nombre }).catch((err: unknown) => {
          // El usuario canceló el menú de compartir: no forzar nada más.
          if ((err as DOMException)?.name === 'AbortError') return;
          alFallar({
            nombre,
            json,
            aviso:
              'Este navegador no permitió guardar el archivo. Copia el JSON o compártelo como texto.',
          });
        });
        return;
      }
    }
    alFallar({
      nombre,
      json,
      aviso:
        'Este navegador no permite guardar archivos. Copia el JSON o compártelo como texto.',
    });
    return;
  }
  guardarArchivo(blob, nombre);
}

export default function GenericoPage() {
  const [fase, setFase] = useState<Fase>('inicio');
  const [molde, setMolde] = useState<MoldeUniversal | null>(null);
  const [moldeOrigen, setMoldeOrigen] = useState<'auto' | 'manual' | null>(null);
  const [recon, setRecon] = useState<EstadoRecon>('pendiente');
  const [confianza, setConfianza] = useState(0);
  const [selectorManual, setSelectorManual] = useState(false);
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [verificaciones, setVerificaciones] = useState<Record<number, VerificacionPagina>>({});
  const [verificandoPagina, setVerificandoPagina] = useState<number | null>(null);
  const [progreso, setProgreso] = useState('');
  const [resultado, setResultado] = useState<ResultadoGenerico | null>(null);
  const [guardadoIso, setGuardadoIso] = useState<string | null>(null);
  const [historial, setHistorial] = useState<FilaHistorial[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reportePendiente, setReportePendiente] = useState<{
    nombre: string;
    json: string;
    aviso: string;
  } | null>(null);

  const camaraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const reemplazoRef = useRef<number | null>(null);
  // Espejo del estado para las cadenas async (una captura a la vez).
  const fotosRef = useRef<Foto[]>([]);
  const verificacionesRef = useRef<Record<number, VerificacionPagina>>({});
  const moldeRef = useRef<MoldeUniversal | null>(null);

  const totalPaginas = molde ? paginasEsperadas(molde) : null;
  const documentoCompleto = totalPaginas !== null && fotos.length >= totalPaginas;
  const verificacionActual = fotos.length > 0 ? verificaciones[fotos.length] : undefined;
  const faltantesNumeros: number[] = [];
  if (totalPaginas !== null) {
    for (let n = fotos.length + 1; n <= totalPaginas; n++) faltantesNumeros.push(n);
  }

  const scorePromedio = useMemo(() => {
    const valores = Object.values(verificaciones).map((v) => v.score);
    if (valores.length === 0) return 0;
    return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10;
  }, [verificaciones]);

  const porPagina = useMemo(() => {
    if (!resultado) return [] as Array<[number, CampoVeredicto[]]>;
    const mapa = new Map<number, CampoVeredicto[]>();
    for (const campo of resultado.campos) {
      const lista = mapa.get(campo.pagina);
      if (lista) lista.push(campo);
      else mapa.set(campo.pagina, [campo]);
    }
    return [...mapa.entries()].sort((a, b) => a[0] - b[0]);
  }, [resultado]);

  /** Gate ligero de una hoja: calidad + encabezado (página 1). */
  async function verificarHoja(
    numero: number,
    dataUrl: string,
    moldeActual: MoldeUniversal | null,
  ): Promise<void> {
    setVerificandoPagina(numero);
    try {
      const v = await verificarPagina(dataUrl, numero, moldeActual);
      verificacionesRef.current = { ...verificacionesRef.current, [numero]: v };
      setVerificaciones(verificacionesRef.current);
    } catch (e) {
      setError(
        `No se pudo verificar la página ${numero}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      setVerificandoPagina(null);
    }
  }

  /** Reconocimiento automático de plantilla (página 1, Fase 6). */
  async function reconocer(dataUrl: string): Promise<void> {
    setRecon('identificando');
    try {
      const r = await identificarMolde(dataUrl, MOLDES_INCLUIDOS);
      if (r.molde) {
        moldeRef.current = r.molde;
        setMolde(r.molde);
        setMoldeOrigen('auto');
        setConfianza(r.confianza);
        setRecon('reconocida');
        // La verificación de página 1 se re-corría para incluir el
        // encabezado de la plantilla ya identificada.
        const primera = fotosRef.current[0];
        if (primera) void verificarHoja(1, primera.dataUrl, r.molde);
      } else {
        setRecon('fallo');
        setSelectorManual(true);
      }
    } catch {
      setRecon('fallo');
      setSelectorManual(true);
    }
  }

  async function agregarCaptura(dataUrl: string): Promise<void> {
    setError('');
    const reemplazo = reemplazoRef.current;
    reemplazoRef.current = null;

    if (reemplazo !== null) {
      const numero = reemplazo + 1;
      fotosRef.current = fotosRef.current.map((f, i) =>
        i === reemplazo ? { id: f.id, dataUrl } : f,
      );
      setFotos(fotosRef.current);
      const resto = { ...verificacionesRef.current };
      delete resto[numero];
      verificacionesRef.current = resto;
      setVerificaciones(resto);
      void verificarHoja(numero, dataUrl, moldeRef.current);
      return;
    }

    if (!moldeRef.current) {
      // Sin plantilla identificada solo se acepta la página 1: es la que
      // alimenta el reconocimiento (cascada barata).
      if (fotosRef.current.length >= 1) {
        setError(
          'Espera la identificación de la plantilla antes de capturar más páginas.',
        );
        return;
      }
    } else if (fotosRef.current.length >= (totalPaginas ?? 1)) {
      setError(
        `El molde «${moldeRef.current.nombre}» tiene ${totalPaginas} ${
          totalPaginas === 1 ? 'página' : 'páginas'
        }. Usa REPETIR para cambiar la última.`,
      );
      return;
    }

    const numero = fotosRef.current.length + 1;
    fotosRef.current = [...fotosRef.current, { id: idLocal(), dataUrl }];
    setFotos(fotosRef.current);
    setFase('guiada');
    if (!moldeRef.current) void reconocer(dataUrl);
    void verificarHoja(numero, dataUrl, moldeRef.current);
  }

  async function agregarArchivos(lista: File[] | null): Promise<void> {
    if (!lista || lista.length === 0) return;
    setError('');
    try {
      const dataUrls = await Promise.all(lista.map((a) => leerArchivoComoDataUrl(a)));
      for (const dataUrl of dataUrls) {
        await agregarCaptura(dataUrl);
      }
    } catch (e) {
      setError(`No se pudo leer la imagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Página simulada (demo/verificación sin cámara; el pipeline es el mismo). */
  function capturarSimulada(): void {
    const reemplazo = reemplazoRef.current;
    const pagina = reemplazo !== null ? reemplazo + 1 : fotosRef.current.length + 1;
    const limite = totalPaginas ?? pagina;
    const dataUrl = dibujarPaginaSimulada(
      moldeRef.current,
      Math.min(pagina, limite),
    );
    void agregarCaptura(dataUrl);
  }

  function elegirManual(nombre: string): void {
    const elegido = MOLDES_INCLUIDOS.find((m) => m.nombre === nombre);
    if (!elegido) return;
    moldeRef.current = elegido;
    setMolde(elegido);
    setMoldeOrigen('manual');
    setRecon('manual');
    setSelectorManual(false);
    setError('');
    setFase('guiada');
    const primera = fotosRef.current[0];
    if (primera) void verificarHoja(1, primera.dataUrl, elegido);
  }

  function escanearCamara(): void {
    reemplazoRef.current = null;
    camaraRef.current?.click();
  }

  function abrirArchivos(): void {
    reemplazoRef.current = null;
    galeriaRef.current?.click();
  }

  function repetirUltima(): void {
    if (fotosRef.current.length === 0) return;
    reemplazoRef.current = fotosRef.current.length - 1;
    camaraRef.current?.click();
  }

  function quitarUltima(): void {
    if (fotosRef.current.length === 0) return;
    const numero = fotosRef.current.length;
    fotosRef.current = fotosRef.current.slice(0, -1);
    setFotos(fotosRef.current);
    const resto = { ...verificacionesRef.current };
    delete resto[numero];
    verificacionesRef.current = resto;
    setVerificaciones(resto);
    if (fotosRef.current.length === 0) {
      reiniciar();
    }
  }

  function reiniciar(): void {
    fotosRef.current = [];
    verificacionesRef.current = {};
    moldeRef.current = null;
    setFotos([]);
    setVerificaciones({});
    setMolde(null);
    setMoldeOrigen(null);
    setRecon('pendiente');
    setConfianza(0);
    setSelectorManual(false);
    setVerificandoPagina(null);
    setResultado(null);
    setGuardadoIso(null);
    setError('');
    setProgreso('');
    setZoom(null);
    setReportePendiente(null);
    setFase('inicio');
  }

  /** Evaluación universal final + guardado local con timestamp. */
  async function verificarDocumento(): Promise<void> {
    if (!moldeRef.current || fotosRef.current.length === 0) return;
    setError('');
    setProgreso('Preparando imágenes...');
    setFase('analizando');
    try {
      const r = await evaluarCapturas(
        moldeRef.current,
        fotosRef.current.map((f) => f.dataUrl),
        { onProgreso: setProgreso },
      );
      setResultado(r);
      const iso = new Date().toISOString();
      try {
        await guardarEnHistorial({
          id: idLocal(),
          guardadoEn: iso,
          moldeNombre: r.molde.nombre,
          moldeDocumento: r.molde.documento,
          veredicto: r.veredicto,
          score: scorePromedio,
          paginasEsperadas: r.paginasEsperadas,
          paginasRecibidas: r.paginasRecibidas,
          camposOk: r.universal.ok_count,
          camposTotal: r.universal.total,
        });
      } catch {
        // Sin IndexedDB el veredicto en pantalla no se pierde; el historial
        // simplemente no registra esta fila.
      }
      setGuardadoIso(iso);
      setHistorial(await listarHistorial());
      setFase('resultado');
    } catch (e) {
      setError(
        `No se pudo evaluar: ${e instanceof Error ? e.message : String(e)}`,
      );
      setFase('guiada');
    }
  }

  function mostrarRespaldoReporte(reporte: {
    nombre: string;
    json: string;
    aviso: string;
  }): void {
    setReportePendiente(reporte);
  }

  async function copiarReporte(): Promise<void> {
    if (!reportePendiente) return;
    if (!navigator.clipboard) {
      setReportePendiente({
        ...reportePendiente,
        aviso: 'Este navegador no permite copiar. Selecciona el texto del cuadro.',
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(reportePendiente.json);
      setReportePendiente({ ...reportePendiente, aviso: 'JSON copiado al portapapeles.' });
    } catch {
      setReportePendiente({
        ...reportePendiente,
        aviso: 'No se pudo copiar. Selecciona el texto del cuadro.',
      });
    }
  }

  async function compartirReporteTexto(): Promise<void> {
    if (!reportePendiente) return;
    try {
      await navigator.share({
        text: reportePendiente.json,
        title: reportePendiente.nombre,
      });
    } catch (err: unknown) {
      if ((err as DOMException)?.name !== 'AbortError') {
        setReportePendiente({
          ...reportePendiente,
          aviso: 'No se pudo compartir como texto. Copia el JSON.',
        });
      }
    }
  }

  if (MOLDES_INCLUIDOS.length === 0) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl bg-brand-black px-5 py-10 text-slate-200">
        <h1 className="text-xl font-semibold">Modo genérico</h1>
        <p className="mt-3 text-sm text-[#E52222]">
          Ningún molde empaquetado pasó la validación estructural.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-400">
          {PROBLEMAS_MOLDES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <Link className="mt-6 inline-block text-sm underline" href="/">
          Volver a Tamiz
        </Link>
      </main>
    );
  }

  const estadoCheck: 'ok' | 'alerta' | 'fallo' | 'pendiente' = (() => {
    if (fotos.length === 0) return 'pendiente';
    if (verificandoPagina !== null) return 'pendiente';
    const lista = Object.values(verificaciones);
    if (lista.length < fotos.length) return 'pendiente';
    if (lista.some((v) => v.estado === 'fallo')) return 'fallo';
    if (lista.some((v) => v.estado === 'alerta')) return 'alerta';
    return 'ok';
  })();

  const palabraPildora = verificacionActual
    ? palabraDeScore(verificacionActual.score, verificacionActual.estado)
    : '';

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-brand-black px-4 pb-28 pt-5 text-slate-200">
      {/* ── Barra superior (mock: volver · píldora de score · ✓ decorativo) ── */}
      <header className="mb-4 flex items-center justify-between gap-3">
        {fase === 'inicio' ? (
          <Link
            href="/"
            aria-label="Volver a Tamiz"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-[#10161f] text-slate-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <StitchArrowLeftIcon className="h-5 w-5" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={reiniciar}
            aria-label="Cancelar y volver al inicio del flujo"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-[#10161f] text-slate-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <StitchArrowLeftIcon className="h-5 w-5" />
          </button>
        )}

        <div className="min-w-0 flex-1 text-center">
          {fase !== 'inicio' && (
            <span
              data-testid="pildora-score"
              className={`inline-flex max-w-full items-center gap-2 truncate rounded-full border px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider ${
                verificandoPagina !== null
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                  : verificacionActual
                    ? `${TONO_PILDORA[verificacionActual.estado]} border-transparent`
                    : 'border-slate-800 bg-[#10161f] text-slate-400'
              }`}
            >
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${
                  verificandoPagina !== null
                    ? 'bg-amber-400 animate-pulse'
                    : verificacionActual
                      ? verificacionActual.estado === 'ok'
                        ? 'bg-[#090d12]'
                        : 'bg-[#090d12]/70'
                      : 'bg-slate-500'
                }`}
              />
              <span className="truncate">
                {verificandoPagina !== null
                  ? 'VERIFICANDO…'
                  : verificacionActual
                    ? `${verificacionActual.score.toFixed(1)}/10 ${palabraPildora}`
                    : 'SIN CAPTURAS'}
              </span>
            </span>
          )}
        </div>

        {/* Botón ✓ DECORATIVO (decisión cerrada #7): solo refleja estado. */}
        <span
          role="img"
          aria-label={`Estado del documento: ${
            estadoCheck === 'ok'
              ? 'completo y verificado'
              : estadoCheck === 'alerta'
                ? 'con advertencias'
                : estadoCheck === 'fallo'
                  ? 'con fallas'
                  : 'en progreso'
          }`}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border font-black ${
            estadoCheck === 'ok'
              ? 'border-transparent bg-brand-green text-black'
              : estadoCheck === 'fallo'
                ? 'border-red-500/50 bg-red-500/10 text-[#E52222]'
                : 'border-slate-800 bg-[#10161f] text-slate-500'
          }`}
        >
          {estadoCheck === 'ok' ? '✓' : estadoCheck === 'fallo' ? '✗' : '·'}
        </span>
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-[#E52222]"
        >
          {error}
        </p>
      )}

      {/* ── FASE INICIO ── */}
      {fase === 'inicio' && (
        <section className="space-y-5" aria-label="Inicio del flujo guiado">
          <div className="rounded-2xl border border-slate-800 bg-[#10161f] p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              Tamiz · modo genérico
            </p>
            <h1 className="mt-1 text-lg font-bold text-white">
              Flujo guiado multipágina
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Escanea la página 1: la plantilla se reconoce automáticamente y
              cada hoja se verifica al momento (score de calidad). Al completar
              todas las páginas, el documento se guarda automáticamente en el
              dispositivo.
            </p>
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              <li>· {MOLDES_INCLUIDOS.length} plantillas en el catálogo local</li>
              <li>· Todo offline: nada sale del dispositivo</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#10161f] p-4">
            <p className="text-sm font-semibold text-white">
              Plantilla: se identifica sola con la página 1
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Si el encabezado no alcanza para identificarla, elegirás la
              plantilla manualmente — nada se adivina.
            </p>
            <button
              type="button"
              onClick={() => setSelectorManual(true)}
              className="mt-3 font-mono text-[11px] font-bold uppercase tracking-wider text-[#10b981] underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              Elegir plantilla manualmente
            </button>
          </div>

          {selectorManual && <SelectorManual onElegir={elegirManual} />}

          <FilaCtas
            etiquetaPrimario="ESCANEAR PÁGINA 1"
            onPrimario={escanearCamara}
            onSimulada={capturarSimulada}
            onArchivo={abrirArchivos}
          />

          <p className="text-center text-[11px] text-slate-600">
            La primera lectura descarga el idioma español del OCR; requiere
            internet una vez.
          </p>

          <HistorialListado filas={historial} onRefrescar={async () => setHistorial(await listarHistorial())} />
        </section>
      )}

      {/* ── FASE GUIADA ── */}
      {fase === 'guiada' && (
        <section className="space-y-4" aria-label="Escaneo guiado">
          <BannerPlantilla
            recon={recon}
            molde={molde}
            origen={moldeOrigen}
            confianza={confianza}
          />

          {selectorManual && <SelectorManual onElegir={elegirManual} />}

          {/* Tarjeta del documento: FOTO REAL procesada (decisión #2). */}
          {fotos.length > 0 && (
            <TarjetaDocumento
              foto={fotos[fotos.length - 1]}
              numeroPagina={fotos.length}
              verificacion={verificacionActual}
              verificando={verificandoPagina === fotos.length}
              procesando={recon === 'identificando'}
              onZoom={() => setZoom(fotos[fotos.length - 1]?.dataUrl ?? null)}
              onRepetir={repetirUltima}
              onQuitar={quitarUltima}
              onRepetirSimulada={() => {
                reemplazoRef.current = fotosRef.current.length - 1;
                capturarSimulada();
              }}
            />
          )}

          {/* Verificación POR PÁGINA (mock: «VERIFICACIÓN PAGINA 1») */}
          {fotos.length > 0 && (
            <TarjetaVerificacionPagina
              numero={fotos.length}
              verificacion={verificacionActual}
              verificando={verificandoPagina === fotos.length}
            />
          )}

          {/* Progreso de digitalización + acción requerida (mock) */}
          {totalPaginas !== null && (
            <TarjetaProgreso
              capturadas={fotos.length}
              total={totalPaginas}
              verificaciones={verificaciones}
              verificando={verificandoPagina}
            />
          )}

          {faltantesNumeros.length > 0 && (
            <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Acción requerida
              </p>
              <p className="mt-1 font-mono text-[12px] font-bold uppercase tracking-wide text-amber-200">
                Por favor sigue con las páginas faltantes (
                {faltantesNumeros.join(', ')})
              </p>
            </div>
          )}

          {documentoCompleto ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => void verificarDocumento()}
                disabled={verificandoPagina !== null}
                className="w-full min-h-[52px] rounded-xl bg-brand-green px-4 text-sm font-extrabold uppercase tracking-wider text-black transition-colors hover:bg-[#0fa472] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                Verificar documento completo
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={repetirUltima}
                  className="min-h-[44px] rounded-xl border border-slate-700 bg-[#10161f] px-3 text-xs font-semibold text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                >
                  Repetir última página
                </button>
                <button
                  type="button"
                  onClick={quitarUltima}
                  className="min-h-[44px] rounded-xl border border-slate-700 bg-[#10161f] px-3 text-xs font-semibold text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                >
                  Quitar última página
                </button>
              </div>
            </div>
          ) : (
            <FilaCtas
              etiquetaPrimario={
                totalPaginas !== null && fotos.length >= 1
                  ? `ESCANEAR PÁGINA ${fotos.length + 1}`
                  : 'ESCANEAR PÁGINA 1'
              }
              onPrimario={escanearCamara}
              onSimulada={capturarSimulada}
              onArchivo={abrirArchivos}
            />
          )}

          <p className="text-center text-[11px] text-slate-600">
            La primera lectura descarga el idioma español del OCR; requiere
            internet una vez.
          </p>
        </section>
      )}

      {/* ── FASE ANALIZANDO ── */}
      {fase === 'analizando' && (
        <section
          aria-live="polite"
          className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center"
        >
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-[#10b981]" />
          <p className="text-sm font-medium text-white">Analizando documento</p>
          <p className="max-w-sm text-xs leading-relaxed text-slate-400">
            {progreso || 'Preparando...'}
          </p>
          <p className="text-[11px] text-slate-600">
            No cierres la aplicación. En documentos de varias páginas esto puede
            tardar unos minutos.
          </p>
        </section>
      )}

      {/* ── FASE RESULTADO ── */}
      {fase === 'resultado' && resultado && (
        <section className="space-y-4" aria-label="Resultado del documento">
          {/* Guardado automático con hora (mock 2, decisión #6) */}
          {guardadoIso && (
            <div
              role="status"
              data-testid="guardado-automatico"
              className="rounded-xl border border-[#10b981]/40 bg-[#10b981]/15 px-4 py-2.5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden className="shrink-0 text-sm font-bold text-[#10b981]">
                    ✓
                  </span>
                  <span className="truncate font-mono text-[13px] font-bold uppercase tracking-wider text-[#10b981]">
                    Documento guardado automáticamente
                  </span>
                </span>
                <span className="shrink-0 rounded-md border border-slate-800 bg-[#090d12] px-2.5 py-1 font-mono text-xs font-bold text-white tabular-nums">
                  {horaDeGuardado(guardadoIso)}
                </span>
              </div>
            </div>
          )}

          {/* Verificación DOCUMENTAL global (mock 2) */}
          <TarjetaVerificacionGlobal
            resultado={resultado}
            scorePromedio={scorePromedio}
          />

          {/* Resumen de las verificaciones por página */}
          <div className="rounded-2xl border border-slate-800 bg-[#10161f] p-4">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Verificación por página
            </h3>
            <ul className="mt-2 space-y-1.5">
              {Object.values(verificaciones)
                .sort((a, b) => a.numero - b.numero)
                .map((v) => (
                  <li
                    key={v.numero}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-[#090d12]/70 px-3 py-2"
                  >
                    <span className="font-mono text-[11px] font-bold uppercase text-slate-200">
                      Página {v.numero}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-slate-300 tabular-nums">
                        {v.score.toFixed(1)}/10
                      </span>
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${
                          v.estado === 'ok'
                            ? 'border-[#10b981]/40 bg-[#10b981]/10 text-[#10b981]'
                            : v.estado === 'alerta'
                              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                              : 'border-red-500/40 bg-red-500/10 text-[#E52222]'
                        }`}
                      >
                        {palabraDeScore(v.score, v.estado)}
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
          </div>

          {/* Campos por página (igual que antes, data-driven del motor) */}
          <div className="space-y-3">
            {porPagina.map(([pagina, campos]) => {
              const sinCapturar = campos.every((c) =>
                c.banderas.includes('pagina_faltante'),
              );
              return (
                <div
                  key={pagina}
                  className="overflow-hidden rounded-2xl border border-slate-800 bg-[#10161f]"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                    <h3 className="text-sm font-semibold text-white">
                      Página {pagina}
                    </h3>
                    <span className="text-[11px] text-slate-500">
                      {sinCapturar ? 'No capturada' : `${campos.length} campos`}
                    </span>
                  </div>
                  <ul className="divide-y divide-slate-800/80">
                    {campos.map((campo) => {
                      const rol = ROL_CAMPO[campo.rol];
                      return (
                        <li key={campo.id} className="px-4 py-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-slate-200">
                                {campo.etiqueta}
                                {campo.obligatorio && (
                                  <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                                    obligatorio
                                  </span>
                                )}
                              </p>
                              <p className="mt-0.5 break-words text-[11px] text-slate-400">
                                {valorVisible(campo)}
                              </p>
                              <p className="mt-0.5 text-[10px] text-slate-600">
                                {campo.tipo} · {ESTADO_CAMPO[campo.estado]}
                                {campo.ratio !== null &&
                                  ` · tinta ${campo.ratio.toFixed(3)}`}
                                {typeof campo.conf === 'number' &&
                                  ` · conf ${(campo.conf * 100).toFixed(0)}%`}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${rol.chip}`}
                            >
                              {rol.texto}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#10161f] p-4">
            <h3 className="text-sm font-semibold text-white">Motivos</h3>
            <ul className="mt-2 space-y-1.5">
              {resultado.motivos.map((motivo) => (
                <li
                  key={motivo}
                  className="flex gap-2 text-xs leading-relaxed text-slate-300"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                  <span>{motivo}</span>
                </li>
              ))}
            </ul>
          </div>

          {resultado.banderas.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-[#10161f] p-4">
              <h3 className="text-xs font-semibold text-slate-400">Banderas</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {resultado.banderas.map((bandera) => (
                  <span
                    key={bandera}
                    className="rounded-md bg-[#090d12] px-2 py-0.5 font-mono text-[10px] text-slate-300"
                  >
                    {bandera}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() =>
                descargarReporte(resultado, mostrarRespaldoReporte)
              }
              className="min-h-[48px] rounded-xl bg-brand-green px-4 py-3 text-sm font-bold text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              Descargar reporte JSON
            </button>
            <button
              type="button"
              onClick={reiniciar}
              className="min-h-[48px] rounded-xl border border-slate-700 bg-[#10161f] px-4 py-3 text-sm font-semibold text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              Nuevo escaneo
            </button>
          </div>

          <HistorialListado filas={historial} onRefrescar={async () => setHistorial(await listarHistorial())} />
        </section>
      )}

      {/* ── Visor a pantalla completa (ojo de la tarjeta) ── */}
      {zoom && (
        <div
          role="dialog"
          aria-label="Vista ampliada de la página"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoom(null)}
        >
          { }
          <img
            src={zoom}
            alt="Página capturada ampliada"
            className="max-h-[92vh] max-w-full rounded-lg border border-slate-800 object-contain"
          />
          <button
            type="button"
            onClick={() => setZoom(null)}
            className="absolute right-4 top-4 rounded-full border border-slate-700 bg-[#090d12] px-3 py-1.5 font-mono text-[11px] font-bold uppercase text-slate-300"
          >
            Cerrar
          </button>
        </div>
      )}

      <input
        ref={camaraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const lista = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
          e.currentTarget.value = '';
          await agregarArchivos(lista);
        }}
      />
      <input
        ref={galeriaRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const lista = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
          e.currentTarget.value = '';
          await agregarArchivos(lista);
        }}
      />

      {reportePendiente && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#10161f] p-4">
            <h2 className="text-sm font-semibold text-white">{reportePendiente.nombre}</h2>
            <p className="mt-1 text-xs text-slate-400">{reportePendiente.aviso}</p>
            <textarea
              readOnly
              value={reportePendiente.json}
              className="mt-3 h-48 w-full resize-none rounded-lg border border-slate-700 bg-[#090d12] p-2 font-mono text-[10px] text-slate-300"
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  void copiarReporte();
                }}
                className="rounded-lg bg-brand-green px-3 py-2 text-sm font-bold text-black"
              >
                Copiar JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  void compartirReporteTexto();
                }}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200"
              >
                Compartir como texto
              </button>
            </div>
            <button
              type="button"
              onClick={() => setReportePendiente(null)}
              className="mt-2 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── Sub-componentes de la página (locales, sin estado global) ── */

function SelectorManual({ onElegir }: { onElegir: (nombre: string) => void }) {
  return (
    <div
      className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4"
      data-testid="selector-manual"
    >
      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
        Elige la plantilla
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {MOLDES_INCLUIDOS.map((m) => (
          <button
            key={m.nombre}
            type="button"
            onClick={() => onElegir(m.nombre)}
            className="rounded-lg border border-slate-700 bg-[#090d12] px-3 py-2 text-left text-xs text-slate-200 hover:border-[#10b981]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <span className="block font-semibold text-white">{m.nombre}</span>
            <span className="font-mono text-[10px] text-slate-500">
              {paginasEsperadas(m)} {paginasEsperadas(m) === 1 ? 'página' : 'páginas'} ·{' '}
              {m.campos.length} campos
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BannerPlantilla({
  recon,
  molde,
  origen,
  confianza,
}: {
  recon: EstadoRecon;
  molde: MoldeUniversal | null;
  origen: 'auto' | 'manual' | null;
  confianza: number;
}) {
  const texto = (() => {
    if (recon === 'identificando') return 'IDENTIFICANDO PLANTILLA…';
    if (recon === 'fallo') return 'NO SE PUDO IDENTIFICAR — ELIGE LA PLANTILLA';
    if (molde && origen === 'auto')
      return `PLANTILLA RECONOCIDA AUTOMÁTICAMENTE · ${molde.nombre.toUpperCase()} (${Math.round(
        confianza * 100,
      )}%)`;
    if (molde && origen === 'manual')
      return `PLANTILLA SELECCIONADA MANUALMENTE · ${molde.nombre.toUpperCase()}`;
    return 'ESPERANDO LA PÁGINA 1';
  })();
  const tono =
    recon === 'reconocida'
      ? 'text-[#10b981]'
      : recon === 'fallo' || recon === 'manual'
        ? 'text-amber-300'
        : 'text-slate-300';
  const dot =
    recon === 'reconocida'
      ? 'bg-[#10b981]'
      : recon === 'fallo'
        ? 'bg-[#E52222]'
        : recon === 'identificando'
          ? 'bg-amber-400 animate-pulse'
          : 'bg-slate-500';
  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl border border-slate-800 bg-[#10161f] px-4 py-3"
      data-testid="banner-plantilla"
    >
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <p
        className={`min-w-0 flex-1 truncate font-mono text-[11px] font-bold uppercase tracking-wider ${tono}`}
      >
        {texto}
      </p>
      {molde && (
        <span className="shrink-0 font-mono text-[10px] text-slate-500">
          {paginasEsperadas(molde)} {paginasEsperadas(molde) === 1 ? 'pág' : 'págs'}
        </span>
      )}
    </div>
  );
}

function TarjetaDocumento({
  foto,
  numeroPagina,
  verificacion,
  verificando,
  procesando,
  onZoom,
  onRepetir,
  onQuitar,
  onRepetirSimulada,
}: {
  foto: Foto;
  numeroPagina: number;
  verificacion: VerificacionPagina | undefined;
  verificando: boolean;
  procesando: boolean;
  onZoom: () => void;
  onRepetir: () => void;
  onQuitar: () => void;
  onRepetirSimulada: () => void;
}) {
  return (
    <div className="relative rounded-2xl border border-slate-800 bg-[#10161f] p-3.5">
      {/* Píldora flotante del score (misma piel que REVISIÓN) */}
      {verificacion && !verificando && (
        <span
          className={`absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full px-3.5 py-1.5 font-mono text-[11px] font-extrabold uppercase tracking-wider shadow-md ${
            TONO_PILDORA[verificacion.estado]
          }`}
        >
          ✓ {verificacion.score.toFixed(1)}/10{' '}
          {palabraDeScore(verificacion.score, verificacion.estado)}
        </span>
      )}
      {verificando && (
        <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-500/50 bg-[#10161f] px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-300">
          Verificando página {numeroPagina}…
        </span>
      )}
      {procesando && (
        <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-500/50 bg-[#10161f] px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-300">
          Identificando plantilla…
        </span>
      )}

      {/* La FOTO REAL (procesada: recorte + b/n + deskew), nunca un dibujo. */}
      <button
        type="button"
        onClick={onZoom}
        aria-label={`Ampliar página ${numeroPagina}`}
        className="mt-2 block w-full overflow-hidden rounded-lg border border-slate-700 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        { }
        <img
          src={verificacion?.dataUrlProcesada ?? foto.dataUrl}
          alt={`Página ${numeroPagina} capturada`}
          className="max-h-[420px] w-full object-contain"
        />
      </button>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
          {verificacion
            ? `Revelada (${verificacion.origen})`
            : 'Página sin verificar aún'}
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={onZoom}
            aria-label="Ver página ampliada"
            className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#090d12] px-3 py-1.5 font-mono text-[10px] font-bold uppercase text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <StitchEyeIcon className="h-3.5 w-3.5" />
            Ver
          </button>
          <button
            type="button"
            onClick={onRepetir}
            className="flex min-h-[36px] items-center rounded-lg border border-slate-700 bg-[#090d12] px-3 py-1.5 font-mono text-[10px] font-bold uppercase text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            Repetir
          </button>
          <button
            type="button"
            onClick={onRepetirSimulada}
            title="Recaptura esta página con datos de simulación (molde conocido)"
            className="flex min-h-[36px] items-center rounded-lg border border-slate-700 bg-[#090d12] px-3 py-1.5 font-mono text-[10px] font-bold uppercase text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            Repetir sim
          </button>
          <button
            type="button"
            onClick={onQuitar}
            className="flex min-h-[36px] items-center rounded-lg border border-slate-700 bg-[#090d12] px-3 py-1.5 font-mono text-[10px] font-bold uppercase text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            Quitar
          </button>
        </span>
      </div>
    </div>
  );
}

function TarjetaVerificacionPagina({
  numero,
  verificacion,
  verificando,
}: {
  numero: number;
  verificacion: VerificacionPagina | undefined;
  verificando: boolean;
}) {
  const [abierta, setAbierta] = useState(true);
  const badge = (() => {
    if (verificando) return { texto: 'VERIFICANDO…', clase: 'text-amber-300 border-amber-500/40 bg-amber-500/10' };
    if (!verificacion) return { texto: 'PENDIENTE', clase: 'text-slate-400 border-slate-700 bg-[#090d12]' };
    if (verificacion.estado === 'ok')
      return { texto: '100% OK', clase: 'text-[#10b981] border-[#10b981]/40 bg-[#10b981]/10' };
    if (verificacion.estado === 'alerta')
      return { texto: 'CON ALERTAS', clase: 'text-amber-300 border-amber-500/40 bg-amber-500/10' };
    return { texto: 'RECHAZADA', clase: 'text-[#E52222] border-red-500/40 bg-red-500/10' };
  })();

  return (
    <div
      className="rounded-2xl border border-slate-800 bg-[#10161f] p-3.5"
      data-testid="verificacion-pagina"
    >
      <button
        type="button"
        onClick={() => setAbierta(!abierta)}
        aria-expanded={abierta}
        className="flex w-full items-center justify-between gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={`font-mono text-sm font-black ${
              verificando
                ? 'text-amber-400'
                : verificacion
                  ? TONO_ITEM[verificacion.estado]
                  : 'text-slate-500'
            }`}
          >
            {verificando ? '·' : verificacion ? GLIFO[verificacion.estado] : '·'}
          </span>
          <span className="text-[13px] font-bold uppercase tracking-wide text-white">
            Verificación página {numero}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${badge.clase}`}
          >
            {badge.texto}
          </span>
          <span aria-hidden className={`font-mono text-[10px] text-slate-400 transition-transform ${abierta ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </span>
      </button>

      {abierta && (
        <ul className="mt-2 space-y-0.5">
          {verificando && (
            <li className="flex items-center gap-2 rounded-lg border border-slate-800/70 bg-[#090d12]/70 px-2.5 py-2 font-mono text-[11px] text-amber-300">
              <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-slate-700 border-t-amber-400" />
              Midiendo calidad de la hoja…
            </li>
          )}
          {!verificando && !verificacion && (
            <li className="rounded-lg border border-slate-800/70 bg-[#090d12]/70 px-2.5 py-2 font-mono text-[11px] text-slate-400">
              Sin medición todavía.
            </li>
          )}
          {!verificando &&
            verificacion?.items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-[#090d12]/70 px-2.5 py-1.5 min-h-[28px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className={`shrink-0 font-mono text-[11px] font-black ${TONO_ITEM[item.estado]}`}>
                    {GLIFO[item.estado]}
                  </span>
                  <span className="truncate font-mono text-[11px] font-semibold text-slate-200">
                    {item.etiqueta}
                  </span>
                </span>
                <span
                  className={`shrink-0 font-mono text-[10px] font-bold uppercase tracking-wide ${TONO_ITEM[item.estado]}`}
                >
                  {item.detalle}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function TarjetaProgreso({
  capturadas,
  total,
  verificaciones,
  verificando,
}: {
  capturadas: number;
  total: number;
  verificaciones: Record<number, VerificacionPagina>;
  verificando: number | null;
}) {
  const paginas = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#10161f] p-4" data-testid="progreso">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-300">
          Progreso de digitalización ({capturadas}/{total})
        </p>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {paginas.map((n) => {
          const v = verificaciones[n];
          const esActual = n === capturadas;
          const verificandoEsta = verificando === n;
          const clase = (() => {
            if (verificandoEsta)
              return 'border-amber-500/60 bg-amber-500/10 text-amber-300';
            if (v?.estado === 'ok') return 'border-[#10b981]/50 bg-[#10b981]/10 text-[#10b981]';
            if (v?.estado === 'alerta') return 'border-amber-500/50 bg-amber-500/10 text-amber-300';
            if (v?.estado === 'fallo') return 'border-red-500/50 bg-red-500/10 text-[#E52222]';
            if (esActual) return 'border-amber-500/60 bg-amber-500/10 text-amber-300';
            return 'border-slate-800 bg-[#090d12] text-slate-500';
          })();
          return (
            <span
              key={n}
              className={`rounded-lg border px-2 py-1.5 text-center font-mono text-[10px] font-bold uppercase ${clase}`}
            >
              {v?.estado === 'ok' ? `✓ pág ${n}` : `pág ${n}`}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TarjetaVerificacionGlobal({
  resultado,
  scorePromedio,
}: {
  resultado: ResultadoGenerico;
  scorePromedio: number;
}) {
  const tono = TONO_VEREDICTO[resultado.veredicto];
  const estado: 'ok' | 'alerta' | 'fallo' =
    resultado.veredicto === 'OPTIMA' ? 'ok' : resultado.veredicto === 'ADVERTENCIA' ? 'alerta' : 'fallo';
  const ok = resultado.universal.ok_count;
  const total = resultado.universal.total;
  return (
    <div className={`rounded-2xl border p-4 ${tono.caja}`} data-testid="verificacion-global">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${tono.punto}`} />
          <h2 className={`text-[15px] font-black uppercase tracking-wide ${tono.titulo}`}>
            Verificación documental
          </h2>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 font-mono text-[11px] font-extrabold uppercase ${TONO_PILDORA[estado]}`}
        >
          {scorePromedio.toFixed(1)}/10
        </span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-white">{resultado.molde.nombre}</p>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-slate-400">
        Páginas: {resultado.paginasRecibidas}/{resultado.paginasEsperadas} · Campos OK: {ok}/{total} ·{' '}
        {tono.etiqueta}
      </p>
    </div>
  );
}

function FilaCtas({
  etiquetaPrimario,
  onPrimario,
  onSimulada,
  onArchivo,
}: {
  etiquetaPrimario: string;
  onPrimario: () => void;
  onSimulada: () => void;
  onArchivo: () => void;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onPrimario}
        data-testid="cta-escanear"
        className="w-full min-h-[52px] rounded-xl bg-brand-green px-4 text-sm font-extrabold uppercase tracking-wider text-black transition-colors hover:bg-[#0fa472] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
      >
        {etiquetaPrimario}
      </button>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onSimulada}
          data-testid="cta-simulada"
          className="min-h-[44px] rounded-xl border border-slate-700 bg-[#10161f] px-3 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          Simulación
        </button>
        <button
          type="button"
          onClick={onArchivo}
          data-testid="cta-archivo"
          className="min-h-[44px] rounded-xl border border-slate-700 bg-[#10161f] px-3 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          Archivo
        </button>
      </div>
    </div>
  );
}

function HistorialListado({
  filas,
  onRefrescar,
}: {
  filas: FilaHistorial[];
  onRefrescar: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#10161f] p-4" data-testid="historial">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Guardados recientes (local)
        </h3>
        <button
          type="button"
          onClick={() => void onRefrescar()}
          className="font-mono text-[10px] font-bold uppercase text-slate-500 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          Refrescar
        </button>
      </div>
      {filas.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Aún no hay documentos guardados en este dispositivo.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {filas.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-[#090d12]/70 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-200">
                  {f.moldeNombre}
                </span>
                <span className="font-mono text-[10px] text-slate-500">
                  {f.paginasRecibidas}/{f.paginasEsperadas} págs · {f.camposOk}/{f.camposTotal} campos ·{' '}
                  {f.score.toFixed(1)}/10
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${
                    f.veredicto === 'OPTIMA'
                      ? 'border-[#10b981]/40 bg-[#10b981]/10 text-[#10b981]'
                      : f.veredicto === 'ADVERTENCIA'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : 'border-red-500/40 bg-red-500/10 text-[#E52222]'
                  }`}
                >
                  {f.veredicto}
                </span>
                <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                  {horaDeGuardado(f.guardadoEn)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
