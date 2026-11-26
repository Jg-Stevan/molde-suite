---
id: "app_tamiz-ppocr-keys-offline-2026-11-26"
plantilla: "(entorno de verificación — no es un molde)"
tipo_documento: "app_tamiz"
condicion: "checkout fresco de main + verificación en navegador (dev :3000 y build estático BUILD_STATIC=1)"
herramientas_usadas: ["assets.lock.json", "preparar-assets.mjs", "sw.js (cache-first)", "PwaRegister"]
version_motor: "agent-b/mvp-captura-pwa (base main ccb85b1)"
resultado: "fallo_robustez"
campos_fallidos: ["(pipeline OCR completo)"]
metrica: { veredictos_ok: "0/1 antes del fix → 1/1 después", zonas_correctas: "n/a" }
---

## Problema observado

1. **Bloqueante total del escaneo**: desde un checkout fresco de main, el
   PRIMER escaneo caía con `[store] escaneo falló {"mensaje":"ppocr_keys.txt
   HTTP 404"}` — el rec de RapidOCR exige el diccionario
   (`packages/scanner-core/ocr/rapidocr.ts` §dict: `fetch(.../ppocr_keys.txt)`
   + `if (!dictResp.ok) throw`). `public/models/rapidocr/` está gitignoreada y
   `apps/tamiz/scripts/assets.lock.json` NO traía la entrada del diccionario:
   el archivo nunca se materializaba. **Ningún documento era escaneable** sin
   arreglo manual del entorno — bloqueaba la verificación §7 completa (B6).
2. **Offline en dev rompe la app**: recargar en modo avión con el SW activo
   sirve el HTML de `/` cacheado en la INSTALACIÓN del SW, que referencia
   chunks de dev (hashes efímeros de Next): la página renderiza pero NO
   hidrata (0 respuestas a clicks). Combo dev+SW cache-first es inválido por
   construcción; el modo avión solo es verificable contra el build estático
   (assets hasheados inmutables — el destino real del PWA).

## Causa raíz

1. El diccionario se asume presente pero nadie lo baja: falta la fila en
   `assets.lock.json` (el mecanismo URL+SHA-256 que existe precisamente para
   esto). Los .onnx SÍ estaban; solo el .txt se olvidó.
2. En dev, `next dev` regenera los chunks con nombres que cambian en cada
   edición; el SW de Tamiz hace cache-first de `/_next/static/` (correcto en
   producción, ilusorio en dev) y el fallback de navegación sirve el `/`
   precacheado con hashes viejos → módulos que ya no existen.

## Qué funcionó / qué no

- ✅ Fix del bloqueante: entrada en `assets.lock.json` (URL PaddleOCR
  `ppocr/utils/ppocr_keys_v1.txt` + SHA-256 `a1c84d9b…`) → `bun run
  preparar-assets.mjs` la materializa con verificación → escaneo operativo
  (SIM completa → OPTIMA 8.9 en la misma sesión).
- ✅ Offline REAL verificado sobre `BUILD_STATIC=1`: primera carga con red →
  modo avión → recarga sirve el shell desde el SW → escaneo completo →
  OPTIMA auto-guardada (capturas 19-21).
- ❌ Offline sobre el dev server: NO es un entorno válido para probar el PWA
  (el hidrato muere con chunks caducados). Documentado como límite de dev;
  la prueba de modo avión se hace contra el estático.

## Recomendación para próximas plantillas / fases

- Regla nueva sugerida para el repo: todo asset que el código haga `fetch()`
  bajo `public/models|vendor|scanner` DEBE tener fila en `assets.lock.json` —
  un grep de `fetch('/models|/vendor` en CI lo haría fallo de build, no de
  campo.
- En A56, antes de probar offline en el teléfono: `BUILD_STATIC=1 bun run
  build` y servir `out/` (o el deploy de Cloudflare), nunca `next dev`.
- Si se quiere offline también en dev: desregistrar el SW en dev
  (`process.env.NODE_ENV !== 'production'` → no register) — decidido NO
  hacerlo en esta entrega para no cambiar el comportamiento del dev del
  mantenedor sin su visto.

## Evidencia

- `apps/tamiz/scripts/assets.lock.json` (entrada ppocr_keys.txt + nota).
- `dev.log` del 2026-11-26: `ppocr_keys.txt HTTP 404` → `OK assets externos ·
  6 archivos` → escaneos verdes.
- Capturas 19-21 (`scripts/resultados/verificacion-agente-b/capturas/`, LOCAL).
