import * as React from "react"

const MOBILE_BREAKPOINT = 768

// F5.3 (react-hooks/set-state-in-effect): patrón useSyncExternalStore en vez
// de setState síncrono dentro del efecto — mismo comportamiento, sin renders
// en cascada.
function subscribeBreakpoint(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeBreakpoint,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
}
