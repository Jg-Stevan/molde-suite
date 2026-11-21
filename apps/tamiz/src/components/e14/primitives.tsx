'use client';

// Primitivas de UI del digitalizador (diseño Stitch oscuro).

import type { ReactNode } from 'react';

interface PrimaryBtnProps {
  variant?: 'solid' | 'outline' | 'ok';
  onClick?: () => void;
  icon?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function PrimaryBtn({ variant = 'solid', onClick, icon, ariaLabel, disabled, children }: PrimaryBtnProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100';
  const estilo =
    variant === 'outline'
      ? 'border border-brand-border bg-brand-surface text-white hover:bg-brand-surfacelight'
      : variant === 'ok'
        ? 'bg-brand-green text-black hover:brightness-110'
        : 'bg-brand-green text-black hover:brightness-110';
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} disabled={disabled} className={`${base} ${estilo}`}>
      {icon}
      {children}
    </button>
  );
}

interface ToolbarBtnProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  'aria-label'?: string;
}

export function ToolbarBtn({ icon, label, onClick, ...rest }: ToolbarBtnProps) {
  const etiqueta = rest['aria-label'] ?? label;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={label}
      disabled={!onClick}
      className="inline-flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-[10px] font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-30"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
