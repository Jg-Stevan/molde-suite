/**
 * F-LENS v5 — elección de la cámara trasera principal (port digielect14).
 * El caso del A56: con `facingMode:'environment'` blando Chrome negocia la
 * gran angular (foco fijo, sin linterna); la elección debe caer en el sensor
 * grande con autofocus real.
 */
import { describe, expect, test } from "bun:test";

import {
  capsCoinciden,
  chooseMainProbe,
  huellaDispositivos,
  lenteCoincide,
  type CameraProbeResult,
} from "../src/lib/e14/core/camara-principal";

function sonda(parcial: Partial<CameraProbeResult> & { deviceId: string }): CameraProbeResult {
  return {
    label: "",
    focusModes: [],
    torch: false,
    maxWidth: 0,
    maxHeight: 0,
    ...parcial,
  };
}

describe("chooseMainProbe (F-LENS v5)", () => {
  test("A56: elige la trasera principal (AF + mayor sensor), no la gran angular", () => {
    const principal = sonda({
      deviceId: "c0-principal",
      label: "cámara trasera principal",
      facingMode: "environment",
      focusModes: ["continuous", "single-shot"],
      torch: true,
      maxWidth: 8160,
      maxHeight: 6120,
    });
    const granAngular = sonda({
      deviceId: "c1-ultra",
      label: "cámara trasera ultra gran angular",
      facingMode: "environment",
      focusModes: ["fixed"],
      maxWidth: 4000,
      maxHeight: 3000,
    });
    const tele = sonda({
      deviceId: "c2-tele",
      label: "cámara trasera teleobjetivo",
      facingMode: "environment",
      focusModes: ["continuous"],
      maxWidth: 4000,
      maxHeight: 3000,
    });
    expect(chooseMainProbe([granAngular, tele, principal])?.deviceId).toBe("c0-principal");
  });

  test("torch desempata a igual resolución y AF", () => {
    const sinTorch = sonda({
      deviceId: "sin-torch",
      label: "cámara trasera",
      facingMode: "environment",
      focusModes: ["continuous"],
      maxWidth: 4000,
      maxHeight: 3000,
    });
    const conTorch = sonda({
      deviceId: "con-torch",
      label: "cámara trasera",
      facingMode: "environment",
      focusModes: ["continuous"],
      torch: true,
      maxWidth: 4000,
      maxHeight: 3000,
    });
    expect(chooseMainProbe([sinTorch, conTorch])?.deviceId).toBe("con-torch");
  });

  test("sin AF (iOS): gana el label más simple, jamás palabras de lente", () => {
    const simple = sonda({
      deviceId: "back",
      label: "Back Camera",
      facingMode: "environment",
      maxWidth: 4032,
      maxHeight: 3024,
    });
    const ultra = sonda({
      deviceId: "ultra",
      label: "Back Ultra Wide Camera",
      facingMode: "environment",
      maxWidth: 4032,
      maxHeight: 3024,
    });
    expect(chooseMainProbe([ultra, simple])?.deviceId).toBe("back");
  });

  test("nunca elige la frontal si hay una trasera", () => {
    const frontal = sonda({
      deviceId: "front",
      label: "cámara frontal",
      facingMode: "user",
      focusModes: ["continuous"],
      maxWidth: 9999,
      maxHeight: 9999,
    });
    const trasera = sonda({
      deviceId: "back",
      label: "Back Camera",
      facingMode: "environment",
      maxWidth: 1000,
      maxHeight: 1000,
    });
    expect(chooseMainProbe([frontal, trasera])?.deviceId).toBe("back");
  });

  test("facing ausente: el label manda para clasificar traseras", () => {
    const trasera = sonda({ deviceId: "rear", label: "rear camera wide", maxWidth: 4000, maxHeight: 3000 });
    const frontal = sonda({ deviceId: "selfie", label: "selfie camera", maxWidth: 8000, maxHeight: 6000 });
    expect(chooseMainProbe([frontal, trasera])?.deviceId).toBe("rear");
  });

  test("sin sondas devuelve null (la cascada decide)", () => {
    expect(chooseMainProbe([])).toBeNull();
  });

  test("E15: la UW/macro no gana aunque reporte AF y la principal no lo liste", () => {
    const principal = sonda({
      deviceId: "main",
      label: "cámara trasera",
      facingMode: "environment",
      focusModes: [],
      torch: true,
      maxWidth: 8160,
      maxHeight: 6120,
    });
    const uw = sonda({
      deviceId: "uw",
      label: "cámara trasera ultra gran angular",
      facingMode: "environment",
      focusModes: ["continuous"],
      maxWidth: 4000,
      maxHeight: 3000,
    });
    const macro = sonda({
      deviceId: "macro",
      label: "cámara trasera macro",
      facingMode: "environment",
      focusModes: ["continuous"],
      maxWidth: 2576,
      maxHeight: 1932,
    });
    expect(chooseMainProbe([uw, macro, principal])?.deviceId).toBe("main");
  });

  test("la regla relativa respeta una única trasera pequeña", () => {
    const uw = sonda({
      deviceId: "uw-sola",
      label: "cámara trasera ultra gran angular",
      facingMode: "environment",
      focusModes: [],
      maxWidth: 2576,
      maxHeight: 1932,
    });
    const frontal = sonda({
      deviceId: "front",
      label: "frontal",
      facingMode: "user",
      maxWidth: 8000,
      maxHeight: 6000,
    });
    expect(chooseMainProbe([frontal, uw])?.deviceId).toBe("uw-sola");
  });
});

describe("huellaDispositivos", () => {
  test("determinista por conjunto (el orden no importa)", () => {
    expect(huellaDispositivos(["b", "a"])).toBe(huellaDispositivos(["a", "b"]));
  });

  test("cambia si cambia el conjunto de cámaras", () => {
    expect(huellaDispositivos(["a", "b"])).not.toBe(huellaDispositivos(["a", "c"]));
    expect(huellaDispositivos(["a", "b"])).not.toBe(huellaDispositivos(["a", "b", "c"]));
  });
});

describe("capsCoinciden (verificación post-apertura)", () => {
  const esperado = { maxWidth: 2576, maxHeight: 1932 };

  test("acepta caps iguales y diferencias dentro del 10 %", () => {
    expect(capsCoinciden(esperado, { width: 2576, height: 1932 })).toBe(true);
    expect(capsCoinciden(esperado, { width: 2560, height: 1920 })).toBe(true);
  });

  test("rechaza otro sensor con el mismo deviceId (renumeración)", () => {
    expect(capsCoinciden(esperado, { width: 1920, height: 1080 })).toBe(false);
  });

  test("sin reporte no se puede refutar", () => {
    expect(capsCoinciden(esperado, null)).toBe(true);
    expect(capsCoinciden(esperado, {})).toBe(true);
    expect(capsCoinciden({ maxWidth: 0, maxHeight: 0 }, { width: 1920, height: 1080 })).toBe(true);
  });
});

describe("lenteCoincide (A12: camera 0 y camera 2 comparten 2576×1932)", () => {
  const principal = {
    label: "camera 0, facing back",
    torch: true,
    focusModes: ["manual", "single-shot", "continuous"],
    maxWidth: 2576,
    maxHeight: 1932,
  };

  test("la UW con el mismo máximo no coincide (torch/AF/label)", () => {
    expect(
      lenteCoincide(principal, {
        label: "camera 2, facing back",
        torch: false,
        focusModes: ["manual"],
        width: 2576,
        height: 1932,
      }),
    ).toBe(false);
  });

  test("la principal abierta sí coincide (con redondeo de caps)", () => {
    expect(
      lenteCoincide(principal, {
        label: "camera 0, facing back",
        torch: true,
        focusModes: ["manual", "single-shot", "continuous"],
        width: 2560,
        height: 1920,
      }),
    ).toBe(true);
  });

  test("sin reporte no se puede refutar", () => {
    expect(lenteCoincide(principal, null)).toBe(true);
  });
});
