'use client';

/**
 * MODO GENÉRICO (Starter) — captura N hojas, evalúa contra un molde
 * empaquetado y decide ÓPTIMA / ADVERTENCIA / RECHAZADA.
 *
 * No usa el store ni las pantallas de E-14 a propósito: E-14 sigue intacto.
 * Todo lo que esta página necesita vive en `src/lib/generico/`.
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
import type {
  CampoVeredicto,
  ResultadoGenerico,
  Veredicto,
} from '@/lib/generico/tipos';

type Vista = 'captura' | 'analizando' | 'resultado';

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
    caja: 'border-emerald-400/40 bg-emerald-500/10',
    titulo: 'text-emerald-300',
    punto: 'bg-emerald-400',
    etiqueta: 'ÓPTIMA',
  },
  ADVERTENCIA: {
    caja: 'border-amber-400/40 bg-amber-500/10',
    titulo: 'text-amber-300',
    punto: 'bg-amber-400',
    etiqueta: 'ADVERTENCIA',
  },
  RECHAZADA: {
    caja: 'border-rose-400/40 bg-rose-500/10',
    titulo: 'text-rose-300',
    punto: 'bg-rose-400',
    etiqueta: 'RECHAZADA',
  },
};

const ROL_CAMPO: Record<
  CampoVeredicto['rol'],
  { chip: string; texto: string }
> = {
  ok: { chip: 'bg-emerald-500/15 text-emerald-300', texto: 'OK' },
  faltante: { chip: 'bg-rose-500/15 text-rose-300', texto: 'FALTANTE' },
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

function descargarReporte(resultado: ResultadoGenerico): void {
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
  const blob = new Blob([JSON.stringify(reporte, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-${slug(resultado.molde.nombre)}-${fecha
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function GenericoPage() {
  const [moldeNombre, setMoldeNombre] = useState(
    () => MOLDES_INCLUIDOS[0]?.nombre ?? '',
  );
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [vista, setVista] = useState<Vista>('captura');
  const [progreso, setProgreso] = useState('');
  const [resultado, setResultado] = useState<ResultadoGenerico | null>(null);
  const [error, setError] = useState('');
  const camaraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const reemplazoRef = useRef<number | null>(null);

  const molde: MoldeUniversal | undefined = useMemo(
    () => MOLDES_INCLUIDOS.find((m) => m.nombre === moldeNombre),
    [moldeNombre],
  );
  const totalPaginas = molde ? paginasEsperadas(molde) : 0;

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

  function reiniciar(): void {
    setFotos([]);
    setResultado(null);
    setError('');
    setProgreso('');
    setVista('captura');
    reemplazoRef.current = null;
  }

  function elegirMolde(nombre: string): void {
    setMoldeNombre(nombre);
    reiniciar();
  }

  /**
   * CORRECCIÓN del starter (honestidad de la entrega): `e.currentTarget.value = ''`
   * vacía el FileList VIVO antes de que `agregarArchivos` lo consuma, así que
   * las fotos nunca entraban al estado. Se hace la copia ANTES de limpiar el
   * input (mismo patrón para cámara y galería).
   */
  async function agregarArchivos(lista: File[] | null): Promise<void> {
    if (!lista || lista.length === 0) return;
    setError('');
    const reemplazo = reemplazoRef.current;
    reemplazoRef.current = null;
    const archivos = lista;
    const dataUrls = await Promise.all(
      archivos.map((a) => leerArchivoComoDataUrl(a)),
    );

    if (reemplazo !== null) {
      const dataUrl = dataUrls[0];
      if (!dataUrl) return;
      setFotos((prev) =>
        prev.map((f, i) => (i === reemplazo ? { ...f, dataUrl } : f)),
      );
      return;
    }

    setFotos((prev) => {
      const espacio = Math.max(0, totalPaginas - prev.length);
      const nuevas = dataUrls
        .slice(0, espacio)
        .map((dataUrl) => ({ id: idLocal(), dataUrl }));
      return [...prev, ...nuevas];
    });
  }

  function quitarFoto(indice: number): void {
    setFotos((prev) => prev.filter((_, i) => i !== indice));
  }

  function reemplazarFoto(indice: number): void {
    reemplazoRef.current = indice;
    galeriaRef.current?.click();
  }

  async function verificar(): Promise<void> {
    if (!molde || fotos.length === 0) return;
    setError('');
    setProgreso('Preparando imágenes...');
    setVista('analizando');
    try {
      const r = await evaluarCapturas(
        molde,
        fotos.map((f) => f.dataUrl),
        { onProgreso: setProgreso },
      );
      setResultado(r);
      setVista('resultado');
    } catch (e) {
      setError(
        `No se pudo evaluar: ${e instanceof Error ? e.message : String(e)}`,
      );
      setVista('captura');
    }
  }

  if (MOLDES_INCLUIDOS.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-10 text-slate-200">
        <h1 className="text-xl font-semibold">Modo genérico</h1>
        <p className="mt-3 text-sm text-rose-300">
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

  const tono = resultado ? TONO_VEREDICTO[resultado.veredicto] : null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-slate-950 px-4 pb-28 pt-5 text-slate-200">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Tamiz · modo genérico
          </p>
          <h1 className="text-lg font-semibold text-white">
            Verificar documento
          </h1>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
        >
          Volver
        </Link>
      </header>

      {vista === 'captura' && (
        <section className="space-y-5">
          <div>
            <label
              htmlFor="molde"
              className="mb-1 block text-xs font-medium text-slate-400"
            >
              Molde
            </label>
            <select
              id="molde"
              value={moldeNombre}
              onChange={(e) => elegirMolde(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white"
            >
              {MOLDES_INCLUIDOS.map((m) => (
                <option key={m.nombre} value={m.nombre}>
                  {m.nombre}
                </option>
              ))}
            </select>
            {molde && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                {molde.descripcion ?? molde.documento ?? 'Documento'} ·{' '}
                {totalPaginas}{' '}
                {totalPaginas === 1 ? 'página' : 'páginas'} ·{' '}
                {molde.campos.length} campos ·{' '}
                {molde.campos.filter((c) => c.obligatorio).length} obligatorios
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">
                Hojas capturadas: {fotos.length} de {totalPaginas}
              </p>
              <span className="text-xs text-slate-500">
                {fotos.length === totalPaginas
                  ? 'Completo'
                  : `Faltan ${totalPaginas - fotos.length}`}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Fotografía las hojas en orden. Las páginas que no captures se
              reportan como faltantes y el documento se rechaza.
            </p>

            {fotos.length > 0 && (
              <ul className="mt-4 space-y-2">
                {fotos.map((foto, i) => (
                  <li
                    key={foto.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-2"
                  >
                    <img
                      src={foto.dataUrl}
                      alt={`Hoja ${i + 1}`}
                      className="h-16 w-12 rounded-md object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white">Página {i + 1}</p>
                      <p className="truncate text-xs text-slate-500">
                        {molde && i + 1 > totalPaginas
                          ? 'Sobra para este molde'
                          : 'Captura en orden'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => reemplazarFoto(i)}
                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300"
                    >
                      Reemplazar
                    </button>
                    <button
                      type="button"
                      onClick={() => quitarFoto(i)}
                      className="rounded-lg border border-rose-900/60 px-2.5 py-1 text-xs text-rose-300"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {fotos.length < totalPaginas ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    reemplazoRef.current = null;
                    camaraRef.current?.click();
                  }}
                  className="rounded-xl bg-emerald-500 px-3 py-3 text-sm font-semibold text-slate-950"
                >
                  Tomar foto
                </button>
                <button
                  type="button"
                  onClick={() => {
                    reemplazoRef.current = null;
                    galeriaRef.current?.click();
                  }}
                  className="rounded-xl border border-slate-700 px-3 py-3 text-sm font-medium text-slate-200"
                >
                  Elegir de galería
                </button>
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-emerald-900/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                Ya tienes todas las páginas. Reemplaza o quita una para
                cambiarla.
              </p>
            )}
          </div>

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

          {error && (
            <p className="rounded-lg border border-rose-900/60 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={fotos.length === 0}
            onClick={() => void verificar()}
            className="w-full rounded-xl bg-sky-500 px-4 py-3.5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            {fotos.length === 0
              ? 'Captura al menos una hoja'
              : `Verificar ${fotos.length} ${fotos.length === 1 ? 'hoja' : 'hojas'}`}
          </button>
          <p className="text-center text-[11px] text-slate-600">
            La primera lectura descarga el idioma español del OCR; requiere
            internet una vez.
          </p>
        </section>
      )}

      {vista === 'analizando' && (
        <section
          aria-live="polite"
          className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center"
        >
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
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

      {vista === 'resultado' && resultado && tono && (
        <section className="space-y-5">
          <div className={`rounded-2xl border p-4 ${tono.caja}`}>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${tono.punto}`} />
              <h2 className={`text-lg font-bold tracking-wide ${tono.titulo}`}>
                {tono.etiqueta}
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-300">{resultado.molde.nombre}</p>
            <p className="mt-1 text-xs text-slate-400">
              Páginas: {resultado.paginasRecibidas} de{' '}
              {resultado.paginasEsperadas} · Faltantes duros:{' '}
              {resultado.faltantesDuros.length} · Por revisar:{' '}
              {resultado.porRevisar.length}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
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

          <div className="space-y-3">
            {porPagina.map(([pagina, campos]) => {
              const sinCapturar = campos.every((c) =>
                c.banderas.includes('pagina_faltante'),
              );
              return (
                <div
                  key={pagina}
                  className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50"
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

          {resultado.banderas.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <h3 className="text-xs font-semibold text-slate-400">Banderas</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {resultado.banderas.map((bandera) => (
                  <span
                    key={bandera}
                    className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300"
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
              onClick={() => descargarReporte(resultado)}
              className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950"
            >
              Descargar reporte JSON
            </button>
            <button
              type="button"
              onClick={reiniciar}
              className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-slate-200"
            >
              Nueva captura
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
