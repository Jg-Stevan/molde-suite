'use client';

// Modo dev: flag reactivo por pestaña (localStorage + evento), sin timers.

import { useEffect, useState } from 'react';

const CLAVE = 'tamiz.dev';
const EVENTO = 'tamiz-dev-cambio';

export function useModoDev(): boolean {
  const [modo, setModo] = useState(false);
  useEffect(() => {
    const leer = () => {
      try {
        setModo(window.localStorage.getItem(CLAVE) === '1');
      } catch {
        setModo(false);
      }
    };
    leer();
    window.addEventListener(EVENTO, leer);
    window.addEventListener('storage', leer);
    return () => {
      window.removeEventListener(EVENTO, leer);
      window.removeEventListener('storage', leer);
    };
  }, []);
  return modo;
}

export function alternarModoDev(): void {
  try {
    const activo = window.localStorage.getItem(CLAVE) === '1';
    window.localStorage.setItem(CLAVE, activo ? '0' : '1');
    window.dispatchEvent(new CustomEvent(EVENTO));
  } catch {
    /* sin storage: sin modo dev */
  }
}
