/**
 * Light/dark theme preference. The preference lives in localStorage ('theme');
 * applying it toggles the `dark` class on <html>, which flips the palette
 * variables in styles.css. A matching inline script in the document head
 * (src/routes/__root.tsx) applies it before first paint so there's no flash.
 * Client-only — every function guards for SSR.
 */

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === 'system') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Storage unavailable (private mode) — still apply for this page view.
  }
  applyTheme()
}

/** Sync the `dark` class on <html> with the stored preference / OS setting. */
export function applyTheme() {
  if (typeof document === 'undefined') return
  const pref = getThemePreference()
  const dark =
    pref === 'dark' ||
    (pref === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

/**
 * The pre-paint variant of {@link applyTheme}, inlined into <head> as a plain
 * string so it runs before the app bundle loads. Keep in sync with applyTheme.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`
