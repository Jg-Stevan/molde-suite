// Logger de la app (SPRINT-A A6 — console→logger): centraliza los mensajes
// con nivel y prefijo para poder silenciarlos o enviarlos a observabilidad.

type Datos = Record<string, unknown>;

function linea(nivel: string, msg: string, datos?: Datos): string {
  return `[tamiz:${nivel}] ${msg}${datos ? ' ' + JSON.stringify(datos) : ''}`;
}

export const logger = {
  debug(msg: string, datos?: Datos): void {
    console.debug(linea('debug', msg, datos));
  },
  info(msg: string, datos?: Datos): void {
    console.info(linea('info', msg, datos));
  },
  warn(msg: string, datos?: Datos): void {
    console.warn(linea('warn', msg, datos));
  },
  error(msg: string, datos?: Datos): void {
    console.error(linea('error', msg, datos));
  },
};
