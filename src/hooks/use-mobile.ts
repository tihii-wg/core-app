import * as React from 'react'

const MOBILE_BREAKPOINT = 768

function getIsMobile() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  // Initialize synchronously so the first render already matches the viewport
  // (no desktop-table flash on phones). This app has no SSR/hydration, so
  // reading window during the initial state is safe.
  const [isMobile, setIsMobile] = React.useState<boolean>(getIsMobile)

  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setIsMobile(false)
      return
    }
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener('change', onChange)
    onChange()
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
