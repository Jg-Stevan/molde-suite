/** D3 — WRAPPER: el probe vive en el paquete (geom/); aquí se inyecta lo
 *  adaptativo de Tamiz (§3.1/D3). Universal: sin lógica electoral. */
import { configurarPlan } from "@molde-suite/scanner-core/dominio/plan";
import { presupuestoProbeOrientacionEfectivo } from "./adaptacion/plan";
import { leerFlags } from "./flags";

configurarPlan({
  presupuestoProbeOrientacion: presupuestoProbeOrientacionEfectivo,
  ladoMiniProbe: () => leerFlags().probeMiniLado,
});

export * from "@molde-suite/scanner-core/geom/orientacion";
