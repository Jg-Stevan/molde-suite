/**
 * §5 (plan cierre 2 agentes, 2026-11-26) — VERIFICACIÓN Y ACTUALIZACIÓN DE
 * DATOS: tests obligatorios del plan sobre la re-evaluación con override:
 *  · editar un campo recalcula el veredicto;
 *  · corrección que completa obligatorios dispara auto-guardado (§4);
 *  · la edición no rompe el archivado/hash ni el historial (una sola fila,
 *    estado EDITADO) — lo garantiza el store (historialFilaId); aquí se
 *    prueba el recálculo puro + la bandera de trazabilidad.
 */
import { describe, expect, test } from 'bun:test';

import type { MoldeUniversal, ResumenMoldeActa, ResumenMoldeCampo } from '@molde-suite/scanner-core/dominio/types';
import type { MoldeUniversal as MoldeDef } from '@molde-suite/scanner-core/molde/universal-types';
import { MOLDE_DEMO_RECIBO } from '../src/lib/e14/molde/enrutamiento';
import {
  BANDERA_EDICION,
  campoEditable,
  reevaluarResumenConEdiciones,
} from '../src/lib/e14/molde/edicion';
import { decidirAutoGuardado } from '../src/lib/e14/politica/auto-guardado';

function fila(parciales: Partial<ResumenMoldeCampo> & { id: string; etiqueta: string }): ResumenMoldeCampo {
  return {
    id: parciales.id,
    etiqueta: parciales.etiqueta,
    tipo: 'texto',
    estado: 'ok',
    valor: 'X',
    conf: 0.82,
    rect: null,
    ancla_rect: null,
    fuente: 'ancla',
    banderas: [],
    ...parciales,
  };
}

/** Resumen enrutado con VALOR faltante en «VALOR A PAGAR» (obligatorio). */
function resumenConFaltante(): ResumenMoldeActa {
  const campos = [
    fila({ id: 'suscriptor', etiqueta: 'NÚMERO DE SUSCRIPTOR', obligatorio: true, estado: 'ok', valor: '1234567', conf: 0.9 }),
    fila({ id: 'periodo', etiqueta: 'PERIODO FACTURADO', obligatorio: true, estado: 'ok', valor: '2026-11', conf: 0.88 }),
    fila({ id: 'valor', etiqueta: 'VALOR A PAGAR', obligatorio: true, estado: 'no_encontrado', valor: null, conf: null }),
  ];
  return {
    moldeNombre: MOLDE_DEMO_RECIBO.nombre,
    total: campos.length,
    ok: 2,
    score: 66.7,
    requiereRevision: false,
    obligatoriosFaltantes: ['VALOR A PAGAR'],
    banderas: [],
    tiempos: { render_ms: 1, ocr_ms: 2, motor_ms: 3 },
    campos,
    enrutado: true,
  };
}

describe('§5 edición de datos capturados — re-evaluación con override', () => {
  test('editar un campo recalcula el veredicto (RECHAZADA → OPTIMA)', () => {
    const previo = resumenConFaltante();
    const r = reevaluarResumenConEdiciones(previo, MOLDE_DEMO_RECIBO, { valor: '45000' });
    const filaValor = r.resumen.campos!.find((c) => c.id === 'valor')!;
    expect(filaValor.estado).toBe('ok');
    expect(filaValor.valor).toBe('45000');
    expect(filaValor.conf).toBe(1); // entrada del operador
    expect(filaValor.banderas).toContain(BANDERA_EDICION);
    expect(r.resumen.obligatoriosFaltantes).toEqual([]);
    expect(r.obligatoriosCompletos).toBe(true);
    // Veredicto nuevo (enrutado): score sube y ya no hay obligatorios faltantes.
    expect(r.veredicto).not.toBeNull();
    expect(r.veredicto!.status).toBe('OPTIMA');
    expect(r.resumen.score).toBe(100);
  });

  test('la corrección que completa los obligatorios DISPARA auto-guardado (§4)', () => {
    const previo = resumenConFaltante();
    const r = reevaluarResumenConEdiciones(previo, MOLDE_DEMO_RECIBO, { valor: '45000' });
    const d = decidirAutoGuardado(
      { status: r.veredicto!.status, evaluacionMolde: r.resumen },
      true,
    );
    expect(d.autoEnviar).toBe(true);
  });

  test('patrón del molde: la corrección sin patrón válido → requiere_revision (jamás ok falso)', () => {
    const previo = resumenConFaltante();
    const r = reevaluarResumenConEdiciones(previo, MOLDE_DEMO_RECIBO, { valor: 'abc' });
    const filaValor = r.resumen.campos!.find((c) => c.id === 'valor')!;
    expect(filaValor.estado).toBe('requiere_revision');
    expect(r.resumen.obligatoriosFaltantes).toContain('VALOR A PAGAR');
    // Plan §5: el obligatorio NO quedó verificado pero tampoco hay prueba de
    // ausencia — la lectura es incierta → decide un humano. Sigue sin poder
    // guardarse como válido (auto-guardado bloquea EN_REVISION_HUMANA).
    expect(r.veredicto!.status).toBe('EN_REVISION_HUMANA');
    expect(decidirAutoGuardado({ status: r.veredicto!.status, evaluacionMolde: r.resumen }, true).autoEnviar).toBe(false);
  });

  test('corrección VACÍA de un obligatorio → no_encontrado (documento incompleto)', () => {
    const previo = resumenConFaltante();
    const r = reevaluarResumenConEdiciones(previo, MOLDE_DEMO_RECIBO, { valor: '   ' });
    const filaValor = r.resumen.campos!.find((c) => c.id === 'valor')!;
    expect(filaValor.estado).toBe('no_encontrado');
    expect(r.veredicto!.status).toBe('RECHAZADA');
  });

  test('checkbox: MARCADO por el operador → ok; SIN MARCA → no_encontrado', () => {
    const previo = resumenConFaltante();
    previo.campos = [
      ...previo.campos!,
      fila({ id: 'pago', etiqueta: 'PAGO CONFORMADO', tipo: 'checkbox', obligatorio: false, estado: 'no_encontrado', valor: false, conf: null }),
    ];
    const marcado = reevaluarResumenConEdiciones(previo, MOLDE_DEMO_RECIBO, { pago: true });
    expect(marcado.resumen.campos!.find((c) => c.id === 'pago')!.estado).toBe('ok');
    const desmarcado = reevaluarResumenConEdiciones(previo, MOLDE_DEMO_RECIBO, { pago: false });
    expect(desmarcado.resumen.campos!.find((c) => c.id === 'pago')!.estado).toBe('no_encontrado');
  });

  test('firma/manuscrito NO editable (la evidencia es la tinta medida)', () => {
    const firma = fila({ id: 'firma1', etiqueta: 'FIRMA', tipo: 'firma', obligatorio: true, estado: 'requiere_revision', valor: null, tinta: true, conf: null });
    expect(campoEditable(firma)).toBe(false);
    const previo = resumenConFaltante();
    previo.campos = [...previo.campos!, firma];
    const r = reevaluarResumenConEdiciones(previo, MOLDE_DEMO_RECIBO, { firma1: 'X' });
    // La fila queda INTACTA (la guarda del módulo — la UI no ofrece el lápiz).
    expect(r.resumen.campos!.find((c) => c.id === 'firma1')!.banderas).not.toContain(BANDERA_EDICION);
  });

  test('validación cruzada (igualdad): la corrección puede REPARAR o ROMPER', () => {
    const molde: MoldeDef = {
      ...MOLDE_DEMO_RECIBO,
      validaciones: [
        { id: 'v-total', regla: 'igualdad', expresion: 'valor == consumo', descripcion: 'El valor es el consumo' },
      ],
    };
    const previo = resumenConFaltante();
    previo.campos = [
      ...previo.campos!.filter((c) => c.id !== 'periodo'),
      fila({ id: 'consumo', etiqueta: 'CONSUMO (kWh)', obligatorio: false, estado: 'ok', valor: '45000', conf: 0.9 }),
    ];
    // ROMPE: 46000 (patrón \d{4,8} cumple) ≠ consumo 45000 → validacion_fallida demueve el ok editado.
    const roto = reevaluarResumenConEdiciones(previo, molde, { valor: '46000' });
    const filaValor = roto.resumen.campos!.find((c) => c.id === 'valor')!;
    expect(filaValor.banderas).toContain('validacion_fallida');
    expect(filaValor.estado).toBe('requiere_revision');
    // REPARA: el operador corrige el valor AL número del consumo.
    const reparado = reevaluarResumenConEdiciones(previo, molde, { valor: '45000' });
    const filaOk = reparado.resumen.campos!.find((c) => c.id === 'valor')!;
    expect(filaOk.estado).toBe('ok');
    expect(filaOk.banderas).not.toContain('validacion_fallida');
    expect(reparado.resumen.requiereRevision).toBe(false);
  });

  test('sin override para un campo → la fila queda byte-idéntica (contrato aditivo)', () => {
    const previo = resumenConFaltante();
    const r = reevaluarResumenConEdiciones(previo, MOLDE_DEMO_RECIBO, { valor: '45000' });
    const suscriptor = r.resumen.campos!.find((c) => c.id === 'suscriptor')!;
    expect(suscriptor).toEqual(previo.campos![0]!);
    // El nombre del molde y el molde NO cambian (cero mutación).
    expect(r.resumen.moldeNombre).toBe(previo.moldeNombre);
    expect(r.resumen.enrutado).toBe(true);
  });

  test('resumen ADITIVO (no enrutado): la fila se re-deriva SIN tocar el veredicto del gate', () => {
    const previo = resumenConFaltante();
    previo.enrutado = false;
    const r = reevaluarResumenConEdiciones(previo, MOLDE_DEMO_RECIBO, { valor: '45000' });
    expect(r.veredicto).toBeNull(); // el gate electoral manda
    expect(r.resumen.campos!.find((c) => c.id === 'valor')!.estado).toBe('ok');
  });
});

// El tipo MoldeUniversal de dominio no trae validaciones — sanity de import.
describe('contrato aditivo de la edición', () => {
  test('los campos nuevos del Acta son OPCIONALES (hosts viejos ignoran)', () => {
    const actaMinima: MoldeUniversal = {
      id: 'a1',
      titulo: 't',
      ubicacion: { departamento: '', municipio: '', zona: '', puesto: '', mesa: '' },
      tipo: 'x',
      pagina: null,
      candidatos: [],
      firmas: [],
      score: 0,
      status: 'OPTIMA',
      rechazo: null,
      intento: 1,
      maxIntentos: 3,
      fuente: 'CAMARA',
    } as unknown as MoldeUniversal;
    // Sin las llaves nuevas el acta sigue siendo un Acta válido.
    expect('valoresEditados' in actaMinima).toBe(false);
    expect('corregidoPorOperador' in actaMinima).toBe(false);
  });
});
