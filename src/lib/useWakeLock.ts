import { useEffect } from 'react'

/**
 * Holds a screen wake lock while `active` is true, so the phone doesn't dim or
 * sleep mid-cook. The lock is auto-released by the browser when the tab is
 * hidden, so we re-acquire it on `visibilitychange`. No-op where the API is
 * missing (older browsers / non-secure contexts) — the feature degrades quietly.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen')
      } catch {
        // The UA can reject (e.g. low battery). Cooking mode still works.
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release()
      sentinel = null
    }
  }, [active])
}
