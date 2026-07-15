import { useEffect, useState } from 'react'

/**
 * True when the on-screen (software) keyboard is likely open.
 *
 * There's no direct "is the keyboard up" API, so we watch the visual viewport:
 * when the keyboard opens it shrinks the *visual* viewport well below the
 * *layout* viewport (`window.innerHeight`), which the keyboard doesn't change.
 * A large gap means the keyboard (or a similar overlay) is covering the bottom.
 *
 * SSR-safe (returns `false` until mounted) and a no-op where `visualViewport`
 * isn't available — those clients just keep the bar visible.
 */
export function useKeyboardOpen(threshold = 150): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      // Layout viewport minus visible viewport ≈ height taken by the keyboard.
      setOpen(window.innerHeight - vv.height > threshold)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [threshold])

  return open
}
