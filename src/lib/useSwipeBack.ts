import { useEffect } from 'react'
import { useCanGoBack, useRouter } from '@tanstack/react-router'

// Tuned for a deliberate one-finger swipe rather than an accidental brush.
const MIN_DISTANCE = 80 // px of rightward travel before it counts
const MAX_OFF_AXIS = 60 // px of vertical drift tolerated
const MAX_DURATION = 800 // ms — a swipe, not a slow drag

/** True when the gesture starts somewhere a horizontal drag already means
 *  something (inputs, sliders, an opted-out node, or a horizontally scrollable
 *  container), so we don't hijack it. */
function startsInNoSwipeZone(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-swipe-back]',
    )
  ) {
    return true
  }
  for (
    let el: Element | null = target;
    el && el !== document.body;
    el = el.parentElement
  ) {
    const overflowX = getComputedStyle(el).overflowX
    if (
      (overflowX === 'auto' || overflowX === 'scroll') &&
      el.scrollWidth > el.clientWidth
    ) {
      return true
    }
  }
  return false
}

/**
 * App-wide "swipe right to go back" for touch devices. Unlike iOS's edge-only
 * gesture, the swipe can begin anywhere on screen — handy on larger phones. Only
 * fires for a deliberate, mostly-horizontal one-finger swipe, and only when
 * there's history to go back to. Listeners are passive, so normal scrolling is
 * never blocked.
 */
export function useSwipeBack() {
  const router = useRouter()
  const canGoBack = useCanGoBack()

  useEffect(() => {
    if (!canGoBack) return

    let startX = 0
    let startY = 0
    let startT = 0
    let tracking = false

    const onStart = (e: TouchEvent) => {
      // Bail on multi-touch (pinch/zoom) or zones where a drag is meaningful.
      if (e.touches.length !== 1 || startsInNoSwipeZone(e.target)) {
        tracking = false
        return
      }
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      startT = e.timeStamp
      tracking = true
    }

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      const dt = e.timeStamp - startT
      if (
        dx >= MIN_DISTANCE &&
        Math.abs(dy) <= MAX_OFF_AXIS &&
        Math.abs(dy) <= dx * 0.75 && // keep it clearly horizontal
        dt <= MAX_DURATION
      ) {
        router.history.back()
      }
    }

    const onCancel = () => {
      tracking = false
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onCancel)
    }
  }, [router, canGoBack])
}
