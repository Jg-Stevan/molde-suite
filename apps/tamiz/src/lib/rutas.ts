/** Base del despliegue: '' en la raíz (Cloudflare/local) o una subruta
 *  (GitHub Pages: /molde-suite/tamiz). Los assets públicos y el SW no pasan
 *  por el router de Next, así que se prefijan aquí. */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

export function rutaPublica(ruta: string): string {
  return `${BASE_PATH}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
}
