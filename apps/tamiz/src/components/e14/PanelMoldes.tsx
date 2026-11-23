'use client';

// F6 (PLAN-AGENTE-LAYOUT) — Panel "MOLDES": importar/activar/guardar moldes
// universales (v3) en Tamiz, reemplazando el flujo mínimo del panel DEV.
//
// Entradas (3 rutas, todas pasan por importarMoldeDesdeTexto):
//  · Archivo (.molde.json / .json) — exporte plano o sobre con checksum de Studio.
//  · JSON pegado en textarea — misma validación.
//  · QR con BarcodeDetector nativo (Chrome Android): el payload puede ser
//    JSON crudo (~2,5 KB caben en un QR), una cadena `MOLDE1:` (JSON en
//    base64 + deflate-raw) o una URL — SOLO se permite descargar desde la
//    misma máquina (Studio) o la red local privada; URL pública = bloqueada.
//
// Biblioteca local: moldes guardados en IndexedDB (almacen.ts) con Activar/
// Borrar por fila y migración one-shot desde localStorage viejo.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MoldeUniversal } from '@jg-stevan/scanner-core/molde/universal-types';
import { activarMolde } from '@/lib/e14/molde/registry';
import { importarMoldeDesdeTexto } from '@/lib/e14/molde/importar';
import {
  activarGuardado,
  borrarMolde,
  guardarMolde,
  listarMoldes,
  migrarDesdeLocalStorage,
  type GuardadoMolde,
} from '@/lib/e14/molde/almacen';

// ── Tipos mínimos de BarcodeDetector (no está en lib.dom) ──────────────────
interface LecturaQR {
  rawValue: string;
}
type CtorBarcode = new (opciones?: { formats?: string[] }) => {
  detect: (fuente: CanvasImageSource) => Promise<LecturaQR[]>;
};

/** Constructor nativo o null (para deshabilitar el botón con aviso honesto). */
function ctorBarcode(): CtorBarcode | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { BarcodeDetector?: CtorBarcode }).BarcodeDetector ?? null;
}

/** LAN privada o misma máquina: 192.168.x, 10.x, 172.16–31.x, localhost. */
const RE_LAN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?(\/|$)/i;

/** Payload `MOLDE1:` = JSON en base64 comprimido con deflate-raw. */
async function descomprimirMolde1(payload: string): Promise<string> {
  const CtorDs = (
    window as unknown as {
      DecompressionStream?: new (formato: string) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).DecompressionStream;
  if (!CtorDs) throw new Error('Este navegador no soporta DecompressionStream.');
  const b64 = payload.slice('MOLDE1:'.length).replace(/\s+/g, '');
  const binario = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([binario]).stream().pipeThrough(new CtorDs('deflate-raw'));
  return await new Response(stream).text();
}

interface Props {
  /** Avisa al host (PanelDev) que el molde activo cambió — refresca su dl. */
  onCambio?: () => void;
}

/** Vista previa del molde importado (antes de Activar/Guardar). */
interface VistaPrevia {
  molde: MoldeUniversal;
  checksum?: string;
  leidoEn: Date;
}

export function PanelMoldes({ onCambio }: Props) {
  const [previa, setPrevia] = useState<VistaPrevia | null>(null);
  const [textoPegado, setTextoPegado] = useState('');
  const [errores, setErrores] = useState<string[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [estado, setEstado] = useState<string | null>(null);
  const [guardados, setGuardados] = useState<GuardadoMolde[]>([]);

  // QR
  const [escaneando, setEscaneando] = useState(false);
  const [estadoQr, setEstadoQr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cancelarQrRef = useRef(false);
  const [soportaQr] = useState(() => Boolean(ctorBarcode()));

  const refrescarGuardados = useCallback(async () => {
    setGuardados(await listarMoldes());
  }, []);

  useEffect(() => {
    void migrarDesdeLocalStorage().then(refrescarGuardados);
    return () => {
      cancelarQrRef.current = true;
    };
  }, [refrescarGuardados]);

  /** Una sola puerta de entrada: valida y monta la vista previa (o errores). */
  async function procesarTexto(texto: string) {
    setErrores([]);
    setAvisos([]);
    setEstado(null);
    const r = await importarMoldeDesdeTexto(texto);
    if (r.ok) {
      setPrevia({ molde: r.molde, checksum: r.checksum, leidoEn: new Date() });
      setAvisos(r.avisos);
    } else {
      setPrevia(null);
      setErrores(r.errores);
    }
  }

  async function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    try {
      await procesarTexto(await archivo.text());
    } catch (err) {
      setErrores([`No se pudo leer el archivo: ${(err as Error).message}`]);
    }
  }

  async function onAplicarPegado() {
    if (!textoPegado.trim()) return;
    await procesarTexto(textoPegado);
  }

  // ── QR ────────────────────────────────────────────────────────────────────
  async function procesarPayloadQr(payload: string) {
    const limpio = payload.trim();
    try {
      if (/^https?:\/\//i.test(limpio)) {
        const url = new URL(limpio);
        const mismaMaquina =
          url.host === window.location.host || RE_LAN.test(limpio);
        if (
          !window.confirm(
            `El QR apunta a una URL: ${limpio}\n¿Descargar el molde desde ahí? (solo se permiten URLs de la red local de Studio)`,
          )
        ) {
          setEstadoQr('Descarga cancelada por el operador.');
          return;
        }
        if (!mismaMaquina) {
          setErrores([
            'La URL del QR no es de esta máquina ni de la red local privada: descarga bloqueada.',
          ]);
          return;
        }
        const res = await fetch(limpio);
        if (!res.ok) {
          setErrores([`La descarga del QR falló (HTTP ${res.status}).`]);
          return;
        }
        setEstadoQr('QR leído: descargando molde…');
        await procesarTexto(await res.text());
        return;
      }
      if (limpio.startsWith('MOLDE1:')) {
        setEstadoQr('QR leído: descomprimiendo molde…');
        await procesarTexto(await descomprimirMolde1(limpio));
        return;
      }
      // JSON crudo (lo que cabe en ~2,5 KB de QR).
      await procesarTexto(limpio);
    } catch (err) {
      setErrores([`QR: ${(err as Error).message}`]);
    }
  }

  async function onEscanearQr() {
    const Ctor = ctorBarcode();
    if (!Ctor || !videoRef.current) return;
    cancelarQrRef.current = false;
    setErrores([]);
    setEstadoQr('Abriendo cámara…');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setEscaneando(true);
      setEstadoQr('Escaneando… (20 s máx, botón CANCELAR disponible)');
      const detector = new Ctor({ formats: ['qr_code'] });
      const t0 = Date.now();
      let payload: string | null = null;
      while (!cancelarQrRef.current && Date.now() - t0 < 20000) {
        const lecturas = await detector.detect(videoRef.current);
        if (lecturas.length > 0 && typeof lecturas[0]?.rawValue === 'string') {
          payload = lecturas[0].rawValue;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (cancelarQrRef.current) {
        setEstadoQr('Escaneo cancelado.');
        return;
      }
      if (!payload) {
        setEstadoQr('No se detectó ningún QR en 20 s.');
        return;
      }
      await procesarPayloadQr(payload);
    } catch (err) {
      setEstadoQr(null);
      setErrores([`Cámara/QR: ${(err as Error).message}`]);
    } finally {
      setEscaneando(false);
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    }
  }

  function onCancelarQr() {
    cancelarQrRef.current = true;
  }

  // ── Acciones de la vista previa y de la biblioteca ────────────────────────
  async function onActivarPrevia() {
    if (!previa) return;
    const r = activarMolde(previa.molde);
    if (r.ok) {
      setEstado(`MOLDE ACTIVO: ${r.nombre}`);
      setPrevia(null);
      onCambio?.();
    } else {
      setErrores(r.errores);
    }
  }

  async function onGuardarPrevia() {
    if (!previa) return;
    try {
      const fila = await guardarMolde(previa.molde, previa.checksum);
      setEstado(`Guardado en el dispositivo: ${fila.nombre}`);
      void refrescarGuardados();
    } catch (err) {
      setErrores([`No se pudo guardar: ${(err as Error).message}`]);
    }
  }

  async function onActivarGuardado(id: string, nombre: string) {
    const r = await activarGuardado(id);
    if (r.ok) {
      setEstado(`MOLDE ACTIVO: ${nombre}`);
      onCambio?.();
    } else {
      setErrores(r.errores);
    }
  }

  async function onBorrarGuardado(id: string) {
    try {
      await borrarMolde(id);
      void refrescarGuardados();
    } catch (err) {
      setErrores([`No se pudo borrar: ${(err as Error).message}`]);
    }
  }

  const formatoFecha = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="mt-3 rounded-lg border border-brand-border p-2.5">
      <p className="font-mono text-[10px] font-bold text-white/70">MOLDES (UNIVERSAL v3)</p>

      {/* Modo documento genérico: catálogo empaquetado en el build. NO precarga
          moldes en la biblioteca E-14 ni activa nada: la biblioteca del operador
          queda intacta (decisión del plan, sección 4.9). */}
      <Link
        href="/generico/"
        className="mt-2 flex items-center justify-between rounded-xl border border-sky-800/60 bg-sky-500/10 px-4 py-3 hover:border-sky-500"
      >
        <span>
          <span className="block text-sm font-semibold text-sky-200">
            Verificar con moldes incluidos
          </span>
          <span className="block text-xs text-sky-200/60">
            Captura cualquier documento del catálogo sin importar JSON
          </span>
        </span>
        <span aria-hidden className="text-sky-300">→</span>
      </Link>

      {/* Importar archivo */}
      <label className="mt-2 block w-full cursor-pointer rounded-lg border border-brand-border px-3 py-2 text-center font-mono text-[10px] font-bold text-white/80 hover:border-brand-green">
        IMPORTAR ARCHIVO (.molde.json / .json)
        <input type="file" accept=".json,application/json" className="hidden" onChange={onArchivo} />
      </label>

      {/* Pegar JSON */}
      <textarea
        value={textoPegado}
        onChange={(e) => setTextoPegado(e.target.value)}
        placeholder={'Pega el JSON del molde: { "tipo": "universal", … }'}
        aria-label="Pegar JSON del molde"
        className="mt-1.5 max-h-32 min-h-16 w-full rounded-lg border border-brand-border bg-black/40 p-2 font-mono text-[10px] text-white/80 placeholder:text-white/30"
      />
      <button
        type="button"
        onClick={onAplicarPegado}
        disabled={!textoPegado.trim()}
        className="mt-1 w-full rounded-lg border border-brand-border px-3 py-2 font-mono text-[10px] font-bold text-white/80 hover:border-brand-green disabled:opacity-40"
      >
        APLICAR JSON PEGADO
      </button>

      {/* Escanear QR */}
      <button
        type="button"
        onClick={onEscanearQr}
        disabled={!soportaQr || escaneando}
        title={soportaQr ? undefined : 'Requiere Chrome Android'}
        className="mt-1.5 w-full rounded-lg border border-brand-border px-3 py-2 font-mono text-[10px] font-bold text-white/80 hover:border-brand-green disabled:opacity-40"
      >
        {escaneando ? 'ESCANEANDO…' : 'ESCANEAR QR'}
      </button>
      <p className="mt-1 font-mono text-[9px] leading-relaxed text-white/40">
        {soportaQr
          ? 'nota: el QR lleva el JSON crudo si cabe (~2,5 KB) o una URL de la red local de Studio.'
          : 'nota: requiere Chrome Android (BarcodeDetector nativo).'}
      </p>

      {/* Vista de cámara para el QR: SIEMPRE montada (el ref debe existir al
          pulsar ESCANEAR QR); invisible (sr-only) cuando no se escanea. */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className={
          escaneando
            ? 'mt-1.5 max-h-40 w-full rounded-lg border border-brand-border bg-black/60 object-cover'
            : 'sr-only'
        }
        aria-label="Vista previa de cámara para escanear QR"
      />

      {escaneando ? (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={onCancelarQr}
            className="mt-1 w-full rounded-lg border border-brand-border px-3 py-2 font-mono text-[10px] font-bold text-white/60 hover:border-brand-green"
          >
            CANCELAR ESCANEO
          </button>
        </div>
      ) : null}

      {estadoQr ? (
        <p className="mt-1.5 font-mono text-[10px] text-white/60" role="status">
          {estadoQr}
        </p>
      ) : null}

      {/* Errores de validación */}
      {errores.length > 0 ? (
        <div className="mt-1.5 rounded-lg border border-red-500/40 bg-red-500/10 p-2" role="alert">
          <p className="font-mono text-[10px] font-bold text-red-300">MOLDE RECHAZADO</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[10px] leading-relaxed text-red-200/90">
            {errores.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Vista previa del molde importado */}
      {previa ? (
        <div className="mt-1.5 rounded-lg border border-brand-green/50 bg-black/30 p-2">
          <dl className="space-y-1 font-mono text-[10px] leading-relaxed">
            <div className="flex justify-between gap-2">
              <dt className="text-white/50">nombre</dt>
              <dd className="max-w-[55%] truncate text-white">{previa.molde.nombre}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-white/50">versión</dt>
              <dd className="text-white/80">{previa.molde.version}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-white/50">campos</dt>
              <dd className="text-white/80">{previa.molde.campos.length}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-white/50">reglas layout</dt>
              <dd className="text-white/80">{previa.molde.layout?.reglas.length ?? 0}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-white/50">leído</dt>
              <dd className="text-white/80">{formatoFecha.format(previa.leidoEn)}</dd>
            </div>
          </dl>
          {avisos.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[9px] leading-relaxed text-amber-300/80">
              {avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={onActivarPrevia}
              className="flex-1 rounded-lg bg-brand-green px-3 py-2 font-mono text-[10px] font-bold text-black hover:brightness-110"
            >
              ACTIVAR
            </button>
            <button
              type="button"
              onClick={onGuardarPrevia}
              className="flex-1 rounded-lg border border-brand-border px-3 py-2 font-mono text-[10px] font-bold text-white/80 hover:border-brand-green"
            >
              GUARDAR EN EL DISPOSITIVO
            </button>
          </div>
        </div>
      ) : null}

      {/* Biblioteca local (IndexedDB) */}
      {guardados.length > 0 ? (
        <div className="mt-2 border-t border-brand-border pt-2">
          <p className="font-mono text-[10px] font-bold text-white/70">
            GUARDADOS ({guardados.length})
          </p>
          <ul className="mt-1 max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {guardados.map((g) => (
              <li key={g.id} className="rounded-lg border border-brand-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="max-w-[60%] truncate font-mono text-[10px] text-white">
                    {g.nombre}
                  </p>
                  <p className="font-mono text-[9px] text-white/50">
                    v{g.version} · {formatoFecha.format(new Date(g.guardadoEn))}
                  </p>
                </div>
                <div className="mt-1 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void onActivarGuardado(g.id, g.nombre)}
                    className="flex-1 rounded-lg bg-brand-green px-2 py-1.5 font-mono text-[10px] font-bold text-black hover:brightness-110"
                  >
                    ACTIVAR
                  </button>
                  <button
                    type="button"
                    onClick={() => void onBorrarGuardado(g.id)}
                    aria-label={`Borrar ${g.nombre}`}
                    className="flex-1 rounded-lg border border-brand-border px-2 py-1.5 font-mono text-[10px] font-bold text-white/80 hover:border-red-400"
                  >
                    BORRAR
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {estado ? (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-brand-green" role="status">
          {estado}
        </p>
      ) : null}
    </div>
  );
}
