/**
 * CHECK LIST VERIFICACIÓN — capa data-driven del panel desplegable de
 * REVISIÓN (mocks «CHECK LIST VERIFICACIÓN» del mantenedor).
 *
 * PRIMER LADRILLO DEL APP UNIVERSAL: los grupos del checklist y sus reglas
 * viven en la CONFIG de la PLANTILLA (DefinicionPlantilla), NO en la UI.
 * Agregar un documento nuevo (recibo de agua, forma, certificado) = agregar
 * una DefinicionPlantilla; el panel de REVISIÓN no cambia una línea.
 *
 * La plantilla E-14 construye sus grupos SOLO desde señales REALES que el
 * motor ya produjo (misma doctrina honesta del repo — nada inventado):
 *  · HUELLAS / FIRMAS      → acta.firmas (estado OK/TENUE/NO_DETECTADO).
 *  · CAMPOS OBLIGATORIOS   → QR capa 0, cabecera, tipo, mesa, página
 *                            (clasificacion + parciales + tipoDeBanda).
 *  · INTEGRIDAD DE IMAGEN  → diagnostico.gate (completa/fondo/votos/
 *                            procesadaVacia) + recortada/recorteLado.
 *  · CAMPOS VARIABLES      → lectura OCR display (dep/mun/puesto/kit).
 *
 * ESTADOS por item: ok (verde) · alerta (ámbar — lectura parcial o señal
 * que no bloquea) · fallo (rojo — dato obligatorio ausente o corte).
 * El CONTADOR global [pasados/total] se pinta con el TONO DEL GATE
 * (RECHAZADA→crit · ADVERTENCIA/EN_RH→warn · resto→ok), como el mock.
 */

import type { Acta } from "@jg-stevan/scanner-core/dominio/types";
import { tipoDeBanda } from "@jg-stevan/scanner-core/dominio/clasificador";

/** Estado de UN item del checklist (semáforo del mock). */
export type EstadoChecklist = "ok" | "alerta" | "fallo";

/** Tono de color (mismo vocabulario de primitives.tsx: ok/warn/crit). */
export type TonoChecklist = "ok" | "warn" | "crit";

export interface ItemChecklist {
  id: string;
  etiqueta: string;
  /** Texto mono del detalle (p. ej. «Margen inferior izquierdo: corte detectado»). */
  detalle: string | null;
  estado: EstadoChecklist;
}

export interface GrupoChecklist {
  id: string;
  titulo: string;
  items: ItemChecklist[];
}

export interface PlantillaChecklist {
  id: string;
  nombre: string;
  grupos: GrupoChecklist[];
}

/** Definición de PLANTILLA — el punto de extensión del app universal. */
export interface DefinicionPlantilla {
  id: string;
  nombre: string;
  construir: (acta: Acta) => PlantillaChecklist;
}

/** recorteLado/ladoEsquina → nombre legible (kit identificacion-codigo-v1). */
const NOMBRE_LADO: Record<string, string> = {
  "sup-izq": "superior izquierdo",
  "sup-der": "superior derecho",
  "inf-izq": "inferior izquierdo",
  "inf-der": "inferior derecho",
};

function itemOk(id: string, etiqueta: string, detalle: string): ItemChecklist {
  return { id, etiqueta, detalle, estado: "ok" };
}
function itemAlerta(id: string, etiqueta: string, detalle: string): ItemChecklist {
  return { id, etiqueta, detalle, estado: "alerta" };
}
function itemFallo(id: string, etiqueta: string, detalle: string): ItemChecklist {
  return { id, etiqueta, detalle, estado: "fallo" };
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** Etiqueta UNIVERSAL del tipo de formulario: los valores internos
 *  "TRANSMISION"/"DELEGADOS" son datos del motor (paquete scanner-core,
 *  NO se tocan) — la UI los pinta genéricos. Exportada para que el
 *  historial de envíos y el panel de clasificación usen la MISMA piel. */
export function etiquetaFormulario(t: string): string {
  if (t === "TRANSMISION" || t === "TRANSMISIÓN") return "PRINCIPAL";
  if (t === "DELEGADOS") return "ANEXO";
  return t;
}

/** G1 del mock — las marcas físicas que la plantilla exige en el papel.
 *  E-14: firmas de los jurados (ActaFirma — OK/TENUE/NO_DETECTADO). */
function grupoFirmas(acta: Acta): GrupoChecklist | null {
  // Guarda defensiva: fixtures/actas parciales pueden venir sin `firmas`.
  if (!acta.firmas?.length) return null;
  const items = acta.firmas.map((f, i) => {
    // Universal: si el nombre trae «JURADO» (dato del acta E-14) se pinta
    // genérico «Firma N» — misma disciplina de etiquetaFormulario.
    const bruto = (f.nombre && f.nombre !== "—" ? f.nombre : null) ?? f.jurado ?? null;
    const etiqueta = bruto && !/jurado/i.test(bruto) ? bruto : `Firma ${i + 1}`;
    if (f.estado === "OK") return itemOk(`firma-${i}`, etiqueta, "Presente");
    if (f.estado === "TENUE") return itemAlerta(`firma-${i}`, etiqueta, "Tenue / baja nitidez");
    return itemFallo(`firma-${i}`, etiqueta, "No detectado");
  });
  return { id: "huellas", titulo: "Huellas / Firmas", items };
}

/** G2 del mock — datos que la plantilla EXIGE leer (su ausencia bloquea). */
function grupoObligatorios(acta: Acta): GrupoChecklist {
  const clasif = acta.clasificacion ?? null;
  const clasifAuto = clasif?.nivel === "AUTO" ? clasif : null;
  const tipoBanda = tipoDeBanda(acta.ocrTexto ?? "");
  const items: ItemChecklist[] = [];

  // QR capa 0 (C-10: solo presencia, jamás contenido del payload).
  if (acta.qrPayload != null) {
    items.push(itemOk("qr", "Código QR (capa 0)", "Payload leído"));
  } else if (acta.qrEstado === "sin-payload") {
    items.push(itemFallo("qr", "Código QR (capa 0)", "Ilegible / Sin lectura"));
  } else {
    items.push(itemAlerta("qr", "Código QR (capa 0)", "No corrió en esta captura"));
  }

  // Cabecera de la plantilla (E-14 → E-14/REGISTRADURÍA).
  const cabeceraMatch = clasif?.parciales?.cabecera === true || clasifAuto != null;
  if (cabeceraMatch) {
    items.push(itemOk("cabecera", "Cabecera del documento", "Match de cabecera"));
  } else if (clasif != null) {
    items.push(itemAlerta("cabecera", "Cabecera del documento", "Cabecera sin match"));
  } else {
    items.push(itemFallo("cabecera", "Cabecera del documento", "Ilegible / Sin lectura"));
  }

  // Tipo de formulario (AUTO → lectura validada · banda OCR → parcial).
  if (clasifAuto?.tipo != null) {
    items.push(itemOk("tipo", "Tipo de formulario", etiquetaFormulario(clasifAuto.tipo)));
  } else if (tipoBanda != null) {
    items.push(itemAlerta("tipo", "Tipo de formulario", `Por banda · ${etiquetaFormulario(tipoBanda)}`));
  } else {
    items.push(itemFallo("tipo", "Tipo de formulario", "Ilegible / Sin lectura"));
  }

  // Documento n.º (AUTO → validado · parciales → cruda display-only).
  const mesaParcial = clasif?.parciales?.mesa ?? null;
  if (clasifAuto?.mesa != null) {
    items.push(itemOk("mesa", "Número de documento", `N.º ${pad3(clasifAuto.mesa)}`));
  } else if (mesaParcial != null) {
    items.push(itemAlerta("mesa", "Número de documento", `N.º ${pad3(mesaParcial)} · parcial`));
  } else {
    items.push(itemFallo("mesa", "Número de documento", "Ilegible / Sin lectura"));
  }

  // Página (misma honestidad del chip: PÁG X DE Y o sin lectura).
  if (clasif != null && acta.pagina != null) {
    items.push(itemOk("pagina", "Página", `Pág ${acta.pagina.index} de ${acta.pagina.total}`));
  } else {
    items.push(itemFallo("pagina", "Página", "Sin lectura"));
  }

  return { id: "obligatorios", titulo: "Campos Obligatorios", items };
}

/** G3 del mock — integridad FÍSICA del papel y de la foto procesada. */
function grupoIntegridad(acta: Acta): GrupoChecklist {
  const d = acta.diagnostico;
  const items: ItemChecklist[] = [];

  // Papel completo (guard-borde: diagnostico.gate.completa o veto INCOMPLETA).
  if (d) {
    items.push(
      d.gate.completa
        ? itemOk("papel", "Papel completo", "Bordes dentro del cuadro")
        : itemFallo("papel", "Papel completo", "Papel cortado por el encuadre"),
    );
  } else if (acta.rechazo?.tipo === "INCOMPLETA") {
    items.push(itemFallo("papel", "Papel completo", "Papel cortado por el encuadre"));
  } else {
    items.push(itemOk("papel", "Papel completo", "Sin sospecha de corte"));
  }

  // Corte de contenido (kit actas-vivas-paginas-v1 / esquinas fiduciales).
  if (acta.recortada) {
    const lado = acta.recorteLado ?? d?.gate.ladoEsquina ?? null;
    const nombre = lado ? (NOMBRE_LADO[lado] ?? lado) : null;
    items.push(
      itemFallo(
        "corte",
        "Margen sin corte",
        nombre ? `Margen ${nombre}: corte detectado` : "Corte de contenido detectado",
      ),
    );
  } else {
    items.push(itemOk("corte", "Margen sin corte", "Sin corte detectado"));
  }

  // Señales que SOLO el diagnóstico real trae (SIM no lo lleva — §9.2).
  if (d) {
    items.push(
      d.gate.fondo
        ? itemAlerta("fondo", "Fondo / sombra", "Fondo incluido en el recorte")
        : itemOk("fondo", "Fondo / sombra", "Limpio"),
    );

    if (!d.gate.votos.skipPag2) {
      items.push(
        d.gate.votos.ok
          ? itemOk(
              "votos",
              "Zona de contenido",
              d.gate.votos.densidadPct != null
                ? `Tinta ${Math.round(d.gate.votos.densidadPct)}%`
                : "Tinta presente",
            )
          : itemFallo("votos", "Zona de contenido", "Sin tinta en la zona de contenido"),
      );
    }

    if (acta.procesadaVacia === true) {
      items.push(itemFallo("tinta-foto", "Tinta de la foto", "Procesada sin tinta suficiente"));
    } else {
      items.push(itemOk("tinta-foto", "Tinta de la foto", "Tinta suficiente"));
    }
  } else if (acta.procesadaVacia === true) {
    items.push(itemFallo("tinta-foto", "Tinta de la foto", "Procesada sin tinta suficiente"));
  }

  return { id: "integridad", titulo: "Integridad de Imagen", items };
}

/** G4 del mock — lectura OCR display de los campos VARIABLES de la plantilla
 *  (informativa: no bloquean el gate — ausencia = ámbar, jamás rojo). */
function grupoVariables(acta: Acta): GrupoChecklist {
  const clasif = acta.clasificacion ?? null;
  const items: ItemChecklist[] = [];

  const pushCampo = (id: string, etiqueta: string, valor: string | null | undefined): void => {
    if (valor) items.push(itemOk(id, etiqueta, valor));
    else items.push(itemAlerta(id, etiqueta, "Sin lectura"));
  };

  pushCampo("departamento", "Departamento", clasif?.departamento?.nombre ?? null);
  pushCampo("municipio", "Municipio", clasif?.municipio?.nombre ?? null);
  pushCampo("puesto", "Sede", clasif?.puesto?.nombre ?? null);

  if (clasif?.kit != null) {
    items.push(
      itemOk(
        "kit",
        "Kit",
        `Kit ${clasif.kit}${clasif.kitFuente ? ` · ${clasif.kitFuente}` : ""}`,
      ),
    );
  } else {
    items.push(itemAlerta("kit", "Kit", "Sin lectura"));
  }

  return { id: "variables", titulo: "Campos Variables", items };
}

/** PLANTILLA ACTIVA — E-14. El día que existan recibos/formas: otra
 *  DefinicionPlantilla en este registro y el selector de plantilla. */
export const PLANTILLA_E14: DefinicionPlantilla = {
  id: "e14",
  nombre: "DOCUMENTO",
  construir: (acta) => ({
    id: "e14",
    nombre: "DOCUMENTO",
    grupos: [
      grupoFirmas(acta),
      grupoObligatorios(acta),
      grupoIntegridad(acta),
      grupoVariables(acta),
    ].filter((g): g is GrupoChecklist => g != null && g.items.length > 0),
  }),
};

/** Construye el checklist del acta según la plantilla (default: E-14). */
export function construirChecklist(
  acta: Acta,
  plantilla: DefinicionPlantilla = PLANTILLA_E14,
): PlantillaChecklist {
  return plantilla.construir(acta);
}

/** Contador [pasados/total] de un grupo (header del grupo en el mock). */
export function conteoDeGrupo(g: GrupoChecklist): { pasados: number; total: number } {
  const total = g.items.length;
  const pasados = g.items.filter((it) => it.estado === "ok").length;
  return { pasados, total };
}

/** Contador global [pasados/total] (header del panel en el mock). */
export function resumenDe(pl: PlantillaChecklist): { pasados: number; total: number } {
  const total = pl.grupos.reduce((acc, g) => acc + g.items.length, 0);
  const pasados = pl.grupos.reduce(
    (acc, g) => acc + g.items.filter((it) => it.estado === "ok").length,
    0,
  );
  return { pasados, total };
}

/** Tono de color del GRUPO: fallo→crit · alerta→warn · todo ok→ok. */
export function tonoDeGrupo(g: GrupoChecklist): TonoChecklist {
  if (g.items.some((it) => it.estado === "fallo")) return "crit";
  if (g.items.some((it) => it.estado === "alerta")) return "warn";
  return "ok";
}

/** Tono del contador GLOBAL — el del GATE (mock: el semáforo del desenlace). */
export function tonoDeStatus(status: Acta["status"]): TonoChecklist {
  if (status === "RECHAZADA") return "crit";
  if (status === "ADVERTENCIA" || status === "EN_REVISION_HUMANA") return "warn";
  return "ok";
}
