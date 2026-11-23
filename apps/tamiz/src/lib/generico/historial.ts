// Historial LOCAL del modo genérico (decisión cerrada #6: guardado
// IndexedDB, sin backend, con timestamp visible). DB NUEVA
// `tamiz-generico-v1` para NO tocar `tamiz-moldes-v1` ni `e14-jornada-v1`
// (regla de la casa: cada esquema vive en su DB o migra con bloques
// `if (vieja < N)` que jamás se editan).
//
// Se guardan METADATOS del veredicto (nada de fotos: el reporte completo
// sigue siendo descargable y nada sale del dispositivo).

const DB_NOMBRE = 'tamiz-generico-v1';
const DB_VERSION = 1;
const STORE = 'documentos';

export interface FilaHistorial {
  id: string;
  /** ISO del momento del guardado (se muestra como HH:MM:SS en la UI). */
  guardadoEn: string;
  moldeNombre: string;
  moldeDocumento: string;
  veredicto: 'OPTIMA' | 'ADVERTENCIA' | 'RECHAZADA';
  /** Promedio del score de calidad de las páginas (0..10, 1 decimal). */
  score: number;
  paginasEsperadas: number;
  paginasRecibidas: number;
  camposOk: number;
  camposTotal: number;
}

function pedir<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB: error'));
  });
}

function abrirDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('porFecha', 'guardadoEn');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB: no se pudo abrir'));
  });
}

/** Guarda (o reemplaza por id) un documento verificado. */
export async function guardarEnHistorial(fila: FilaHistorial): Promise<void> {
  const db = await abrirDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await pedir(tx.objectStore(STORE).put(fila));
    tx.oncomplete = () => db.close();
  } catch (e) {
    db.close();
    throw e;
  }
}

/** Lista el historial más reciente primero (limitado para la UI). */
export async function listarHistorial(limite = 12): Promise<FilaHistorial[]> {
  try {
    const db = await abrirDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const todas = await pedir<FilaHistorial[]>(
        tx.objectStore(STORE).getAll() as IDBRequest<FilaHistorial[]>,
      );
      tx.oncomplete = () => db.close();
      return todas
        .sort((a, b) => b.guardadoEn.localeCompare(a.guardadoEn))
        .slice(0, limite);
    } catch (e) {
      db.close();
      throw e;
    }
  } catch {
    // Sin IndexedDB (navegador bloqueado) el flujo sigue: solo se pierde
    // el historial, nunca el veredicto en pantalla.
    return [];
  }
}

/** Hora visible HH:MM:SS desde el ISO del guardado. */
export function horaDeGuardado(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}
