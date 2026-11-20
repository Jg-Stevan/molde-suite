'use client';

// DocuTemplate Studio — shell único con 4 módulos:
// Biblioteca / Editor / Pruebas / Verificación.
// Header fijo con marca + breadcrumb contextual y footer (diseño Stitch):
// el módulo Editor usa barra oscura con ruta "Inicio › Biblioteca › Editor".

import { useEffect } from 'react';
import {
  ChevronRight,
  FileScan,
  HelpCircle,
  Moon,
  Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import MoldesTab from '@/components/studio/MoldesTab';
import EditorTab from '@/components/studio/EditorTab';
import VerificacionTab from '@/components/studio/VerificacionTab';
import { useStudio, type Pestana } from '@/lib/studio-store';

export default function Home() {
  const { pestana, setPestana, molde, cargarMoldes } = useStudio();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    cargarMoldes();
  }, [cargarMoldes]);

  // El módulo Editor vive en tema oscuro permanente (diseño Stitch screen 2).
  const enEditor = pestana === 'editor';
  const nombreCortoEditor = (molde?.nombre.split('(')[0] ?? '').trim().slice(0, 24) || 'Molde';

  return (
    <div className="flex min-h-screen flex-col bg-surface text-on-surface">
      {/* ============ Header fijo ============ */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl ${
          enEditor
            ? 'border-b border-slate-800 bg-slate-900/95'
            : 'border-b border-slate-200/80 bg-surface-lowest/95 dark:border-slate-800 dark:bg-slate-900/95'
        }`}
      >
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
          {/* Marca + breadcrumb contextual (diseño Stitch) */}
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => setPestana('moldes')}
              className="flex shrink-0 items-center gap-2.5"
              aria-label="Ir a la Biblioteca"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-2xs">
                <FileScan className="h-[19px] w-[19px]" aria-hidden />
              </span>
              <span className="flex flex-col items-start leading-none">
                <span
                  className={`text-sm font-bold tracking-tight ${
                    enEditor ? 'text-white' : 'text-on-surface dark:text-slate-100'
                  }`}
                >
                  DocuTemplate Studio
                </span>
                <span
                  className={`mt-0.5 font-mono text-[9px] uppercase tracking-widest ${
                    enEditor ? 'text-slate-400' : 'text-on-surface-variant dark:text-slate-400'
                  }`}
                >
                  Universal Document Vision &amp; Verification / Forensics
                </span>
              </span>
            </button>

            {enEditor && (
              <>
                <span className="hidden h-4 w-px shrink-0 bg-slate-700 md:block" aria-hidden />
                <nav
                  aria-label="Breadcrumb del editor"
                  className="hidden min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500 md:flex"
                >
                  <button
                    type="button"
                    onClick={() => setPestana('moldes')}
                    className="transition hover:text-indigo-400 hover:underline"
                  >
                    Inicio
                  </button>
                  <ChevronRight className="h-3 w-3 shrink-0 text-slate-600" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setPestana('moldes')}
                    className="transition hover:text-indigo-400 hover:underline"
                  >
                    Biblioteca
                  </button>
                  <ChevronRight className="h-3 w-3 shrink-0 text-slate-600" aria-hidden />
                  <span className="truncate font-semibold text-slate-200">
                    Editor {nombreCortoEditor}
                  </span>
                </nav>
              </>
            )}

            {pestana === 'verificacion' && (
              <>
                <span className="hidden h-4 w-px shrink-0 bg-slate-200 md:block dark:bg-slate-700" aria-hidden />
                <nav
                  aria-label="Breadcrumb de verificación"
                  className="hidden min-w-0 items-center gap-1.5 text-xs font-medium text-on-surface-variant dark:text-slate-400 md:flex"
                >
                  <button
                    type="button"
                    onClick={() => setPestana('moldes')}
                    className="transition hover:text-brand hover:underline dark:hover:text-indigo-400"
                  >
                    Inicio
                  </button>
                  <ChevronRight className="h-3 w-3 shrink-0 text-outline-dim" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setPestana('moldes')}
                    className="transition hover:text-brand hover:underline dark:hover:text-indigo-400"
                  >
                    Biblioteca
                  </button>
                  <ChevronRight className="h-3 w-3 shrink-0 text-outline-dim" aria-hidden />
                  <span className="inline-flex items-center gap-1 truncate font-semibold text-on-surface dark:text-slate-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                    Verificación
                  </span>
                </nav>
              </>
            )}
          </div>

          {/* Ayuda + tema */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Abrir centro de ayuda"
                  title="Ayuda y documentación"
                  className="h-9 w-9 rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <HelpCircle className="h-5 w-5" aria-hidden />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>DocuTemplate Studio — Guía rápida</DialogTitle>
                  <DialogDescription>
                    Circuito recomendado del agente de código: crear el molde → probarlo con fotos reales →
                    leer el reporte → corregir. El usuario verifica visualmente al final.
                  </DialogDescription>
                </DialogHeader>
                <ol className="list-decimal space-y-2 pl-5 text-sm text-on-surface-variant">
                  <li>
                    <strong className="text-on-surface">Biblioteca:</strong> crea el molde desde cero o importa
                    un JSON (universal v3 o E-14 v2, que se convierte automáticamente).
                  </li>
                  <li>
                    <strong className="text-on-surface">Editor:</strong> sube el escaneo de referencia por
                    página, dibuja las zonas y alinea las anclas con OCR.
                  </li>
                  <li>
                    <strong className="text-on-surface">Pruebas:</strong> suelta fotos o PDFs reales; cada
                    archivo genera una corrida guardada en el historial.
                  </li>
                  <li>
                    <strong className="text-on-surface">Verificación:</strong> overlay forense, recortes por
                    campo y reporte JSON para el agente.
                  </li>
                </ol>
                <p className="rounded-lg bg-brand-surface p-3 font-mono text-[11px] text-brand-active dark:text-indigo-300">
                  OCR local (Tesseract.js) + motor de tinta corren 100% en el navegador.
                </p>
              </DialogContent>
            </Dialog>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cambiar tema"
              title="Alternar modo oscuro / claro"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              className={`h-9 w-9 rounded-lg ${
                enEditor
                  ? 'text-slate-400 hover:bg-slate-800'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Moon className={`h-5 w-5 ${enEditor ? 'hidden' : 'dark:hidden'}`} aria-hidden />
              <Sun className={`hidden h-5 w-5 ${enEditor ? 'inline' : 'dark:inline'}`} aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      {/* Navegación móvil (recurso de usabilidad; el diseño de escritorio no la muestra) */}
      <div
        className={`fixed top-16 left-0 right-0 z-40 border-b backdrop-blur-xl md:hidden ${
          enEditor
            ? 'border-slate-800 bg-slate-900/95'
            : 'border-slate-200/80 bg-surface-lowest/95 dark:border-slate-800'
        }`}
      >
        <nav aria-label="Módulos (móvil)" className="mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-3 py-2">
          {(
            [
              { id: 'moldes', nombre: 'Biblioteca' },
              { id: 'editor', nombre: 'Editor' },
              { id: 'verificacion', nombre: 'Verificación' },
            ] as { id: Pestana; nombre: string }[]
          ).map((m) => {
            const activo = pestana === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setPestana(m.id)}
                aria-current={activo ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  activo
                    ? 'bg-primary text-white shadow-2xs'
                    : enEditor
                      ? 'text-slate-400 hover:bg-slate-800'
                      : 'text-on-surface-variant hover:bg-brand-surface'
                }`}
              >
                {m.nombre}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ============ Contenido ============ */}
      <main className="flex flex-1 flex-col pt-16 md:pt-16">
        <div className="pt-11 md:pt-0">
          {pestana === 'moldes' && <MoldesTab />}
          {pestana === 'editor' && <EditorTab />}
          {pestana === 'verificacion' && <VerificacionTab />}
        </div>
      </main>

      {/* ============ Footer pegado abajo ============ */}
      <footer
        className={`mt-auto border-t ${
          enEditor
            ? 'border-slate-800 bg-slate-900'
            : 'border-slate-200 bg-surface-lowest dark:border-slate-800'
        }`}
      >
        <div
          className={`mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-1 px-4 py-2.5 font-mono text-[11px] sm:px-6 ${
            enEditor ? 'text-slate-400' : 'text-on-surface-variant'
          }`}
        >
          <span>DocuTemplate Studio v2.4 | Universal Document Vision &amp; CV Pipeline Telemetry</span>
          <span className="hidden sm:inline">OCR local · Motor de tinta en navegador · Formato universal v3</span>
        </div>
      </footer>
    </div>
  );
}
