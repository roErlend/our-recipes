/** "Kari Nordmann" → "KN"; falls back to the email's first letter. */
export function userInitials(name: string | null | undefined, email: string) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return email.slice(0, 1).toUpperCase()
}

/** Initials in a brand-colored circle — the account affordance in the header
 *  and the identity marker on the profile page. */
export function UserAvatar({
  name,
  email,
  size = 'sm',
}: {
  name: string | null | undefined
  email: string
  size?: 'sm' | 'lg'
}) {
  const sizeClass =
    size === 'lg' ? 'h-16 w-16 text-xl' : 'h-9 w-9 text-sm'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-brand-600 font-semibold text-white ${sizeClass}`}
    >
      {userInitials(name, email)}
    </span>
  )
}
