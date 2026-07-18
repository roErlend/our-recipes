import { useEffect, useState } from 'react'

/**
 * Left/right-handed mode. Left (default) is the app's classic layout — the
 * checkbox on the left edge, under a left thumb; right mirrors each shopping
 * row so the checkbox + name end up on the right edge instead. Per-device
 * preference in localStorage, like the theme ([[src/lib/theme.ts]]).
 */

export type Handedness = 'right' | 'left'

const STORAGE_KEY = 'handedness'
const CHANGE_EVENT = 'handedness-change'

export function getHandedness(): Handedness {
  if (typeof window === 'undefined') return 'left'
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'right' ? 'right' : 'left'
  } catch {
    return 'left'
  }
}

export function setHandedness(value: Handedness) {
  try {
    if (value === 'left') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Storage unavailable — the event still updates open views for this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/**
 * The current handedness, kept in sync with changes from the profile page (and
 * other tabs). SSR-safe: renders the 'left' default first and syncs after
 * mount, so server and client markup agree.
 */
export function useHandedness(): Handedness {
  const [value, setValue] = useState<Handedness>('left')
  useEffect(() => {
    const sync = () => setValue(getHandedness())
    sync()
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return value
}
