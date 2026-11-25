/**
 * F-LENS v5 — elección de la cámara trasera principal (port digielect14).
 * El caso del A56: con `facingMode:'environment'` blando Chrome negocia la
 * gran angular (foco fijo, sin linterna); la elección debe caer en el sensor
 * grande con autofocus real.
 */
import { describe, expect, test } from "bun:test";

import { chooseMainProbe, type CameraProbeResult } from "../src/lib/e14/core/camara-principal";

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
});
