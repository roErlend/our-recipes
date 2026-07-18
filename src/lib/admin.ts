/**
 * The single account allowed into the admin page. Not a secret (it's just an
 * email) — it's used both client-side to show/hide the Admin nav + guard the
 * route, and server-side in `requireAdmin` which is the real enforcement.
 */
export const ADMIN_EMAIL = [ 'erlend.rommetveit@gmail.com']

export const isAdminEmail = (email: string | null | undefined) =>
  !!email && ADMIN_EMAIL.includes(email.toLowerCase())
