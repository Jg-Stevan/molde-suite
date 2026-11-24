// Observabilidad de captura: ErrorBoundary + instalación de hooks globales +
// muestra de rendimiento de acta (perf). Sin backend: se emite a consola con
// el prefijo [obs] — lista para enchufar un transporte real después.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { breadcrumb } from '@molde-suite/scanner-core/obs-base/breadcrumbs';

export interface MuestraPerfActa {
  actaId: string;
  escaneoId?: string;
  status: string;
  intento?: number;
  tiempos: Record<string, number>;
  scoreVisual: number;
  scoreFinal: number;
  gate: string;
  ocrValido: boolean;
  vencido: boolean;
  camino: string;
}

let instalada = false;

/** Idempotente: instala window.onerror + unhandledrejection. */
export function instalarCaptura(): void {
  if (instalada || typeof window === 'undefined') return;
  instalada = true;
  window.addEventListener('error', (e) => {
    breadcrumb('window.error', { mensaje: e.message });
  });
  window.addEventListener('unhandledrejection', (e) => {
    breadcrumb('window.unhandledrejection', { motivo: String(e.reason) });
  });
}

/** Emite la muestra de perf de un acta (una por escaneo — deduplicada por escaneoId). */
export function emitirPerfDeActa(m: MuestraPerfActa): void {
  breadcrumb('acta.perf', m as unknown as Record<string, unknown>);
}

interface Props {
  children?: ReactNode;
}

interface State {
  error: Error | null;
}

/** Envuelve el shell: un crash de render no deja la pantalla en blanco. */
export class ErrorBoundaryObs extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    breadcrumb('react.crash', { mensaje: error.message, componente: info.componentStack?.slice(0, 400) });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-brand-black p-6 text-center">
          <p className="font-mono text-sm font-bold text-brand-green">ALGO SE ROMPIÓ</p>
          <p className="max-w-md text-xs text-white/60">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-brand-green px-4 py-2 text-xs font-bold text-black"
          >
            RECARGAR
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
