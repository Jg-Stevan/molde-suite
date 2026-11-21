'use client';

// Focus trap de diálogos: Tab cíclico, Escape cierra, foco inicial en
// [data-autofocus] y retorno del foco al cerrar.

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(ref: RefObject<HTMLDivElement | null>, abierto: boolean, cerrar: () => void): void {
  useEffect(() => {
    if (!abierto) return;
    const nodo = ref.current;
    const previo = document.activeElement as HTMLElement | null;
    const inicial = nodo?.querySelector<HTMLElement>('[data-autofocus]') ?? null;
    inicial?.focus();

    const alTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cerrar();
        return;
      }
      if (e.key !== 'Tab' || !nodo) return;
      const focuseables = Array.from(nodo.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (!focuseables.length) return;
      const primero = focuseables[0];
      const ultimo = focuseables[focuseables.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alTeclar);
    return () => {
      document.removeEventListener('keydown', alTeclar);
      previo?.focus();
    };
  }, [abierto, cerrar, ref]);
}
