import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from 'react-aria-components'
import {
  Carrot,
  ChefHat,
  ListChecks,
  LogOut,
  Shield,
  UserCircle,
  UserPlus,
  UtensilsCrossed,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { UserAvatar } from '@/components/UserAvatar'
import { isAdminEmail } from '@/lib/admin'
import { useHandedness } from '@/lib/handedness'
import { signOut } from '@/lib/auth-client'
import { useKeyboardOpen } from '@/lib/useKeyboardOpen'
import { useSwipeBack } from '@/lib/useSwipeBack'
import {
  pendingInvitesQueryOptions,
  recipesQueryOptions,
  sharingQueryOptions,
  shoppingQueryOptions,
} from '@/lib/queries'
import { fetchSession } from '@/server/auth'
import { acceptInvite, declineInvite } from '@/server/sharing'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async () => {
    const session = await fetchSession()
    if (!session?.user) {
      throw redirect({ to: '/login' })
    }
    return { user: session.user }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(pendingInvitesQueryOptions()),
  component: AuthedLayout,
})

const navLinkClass = [
  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition',
  'hover:bg-stone-200/60 hover:text-stone-900',
  // Tactile press feedback (works on tap/click for the anchor Link).
  'active:scale-95 active:bg-stone-300/70',
].join(' ')

const activeNavLinkClass = 'bg-white text-brand-700 shadow-sm hover:bg-white'

const NAV = [
  { to: '/shopping', label: 'Handleliste', icon: ListChecks, activeOptions: undefined },
  { to: '/recipes', label: 'Oppskrifter', icon: ChefHat, activeOptions: { exact: false } },
  { to: '/ingredienser', label: 'Ingredienser', icon: Carrot, activeOptions: undefined },
] as const

/** Bottom-tab grid columns by tab count (kept as static classes for Tailwind). */
const MOBILE_COLS: Record<number, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
}

function AuthedLayout() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
  useSwipeBack()
  // Hide the bottom tab bar while the on-screen keyboard is up — it just eats
  // space above the keyboard (and can overlap focused inputs) on phones.
  const keyboardOpen = useKeyboardOpen()

  const nav = isAdminEmail(user.email)
    ? [
        ...NAV,
        { to: '/admin', label: 'Admin', icon: Shield, activeOptions: undefined } as const,
      ]
    : NAV
  const mobileCols = MOBILE_COLS[nav.length] ?? 'grid-cols-4'
  // Right-handed mode mirrors the bottom tab bar too, so the most-used tabs
  // land under a right thumb (matches the shopping list's mirroring).
  const righty = useHandedness() === 'right'
  const mobileNav = righty ? [...nav].reverse() : nav

  async function handleSignOut() {
    await signOut()
    await router.invalidate()
    router.navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-100/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <Link
            to="/shopping"
            className="inline-flex min-w-0 items-center gap-2 text-lg font-bold text-stone-900"
          >
            <UtensilsCrossed className="h-5 w-5 shrink-0 text-brand-600" />
            <span className="truncate">Våre oppskrifter</span>
          </Link>

          {/* Desktop nav. On mobile this collapses to the bottom tab bar below.
              preload="render" warms each section's code + data in the background. */}
          <nav className="ml-4 hidden items-center gap-1 sm:flex">
            {nav.map(({ to, label, icon: Icon, activeOptions }) => (
              <Link
                key={to}
                to={to}
                preload="render"
                className={navLinkClass}
                activeProps={{ className: `${navLinkClass} ${activeNavLinkClass}` }}
                activeOptions={activeOptions}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>

          {/* Account menu: the avatar opens profile settings + logout. */}
          <div className="ml-auto">
            <MenuTrigger>
              <AriaButton
                aria-label="Konto"
                className="cursor-pointer rounded-full outline-none transition hover:opacity-90 data-[pressed]:scale-95 data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-500"
              >
                <UserAvatar name={user.name} email={user.email} />
              </AriaButton>
              <Popover
                placement="bottom end"
                className="min-w-[13rem] rounded-lg border border-stone-200 bg-white py-1 shadow-lg outline-none"
              >
                <div className="border-b border-stone-100 px-3 py-2">
                  <p className="truncate text-sm font-medium text-stone-900">
                    {user.name || user.email}
                  </p>
                  {user.name && (
                    <p className="truncate text-xs text-stone-400">{user.email}</p>
                  )}
                </div>
                <Menu
                  className="outline-none"
                  onAction={(key) => {
                    if (key === 'profile') router.navigate({ to: '/profil' })
                    else if (key === 'sharing') router.navigate({ to: '/deling' })
                    else if (key === 'logout') void handleSignOut()
                  }}
                >
                  <MenuItem
                    id="profile"
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-stone-700 outline-none data-[focused]:bg-brand-50 data-[focused]:text-brand-800"
                  >
                    <UserCircle className="h-4 w-4" />
                    Profilinnstillinger
                  </MenuItem>
                  <MenuItem
                    id="sharing"
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-stone-700 outline-none data-[focused]:bg-brand-50 data-[focused]:text-brand-800"
                  >
                    <UserPlus className="h-4 w-4" />
                    Deling
                  </MenuItem>
                  <MenuItem
                    id="logout"
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-stone-700 outline-none data-[focused]:bg-brand-50 data-[focused]:text-brand-800"
                  >
                    <LogOut className="h-4 w-4" />
                    Logg ut
                  </MenuItem>
                </Menu>
              </Popover>
            </MenuTrigger>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 pb-[calc(4.5rem_+_env(safe-area-inset-bottom))] sm:pb-8">
        <PendingInvites />
        <Outlet />
      </main>

      {/* Mobile bottom tab bar — the primary navigation on phones. Hidden while
          the keyboard is up so it doesn't waste space above it. */}
      <nav
        className={`fixed inset-x-0 bottom-0 z-20 grid ${mobileCols} border-t border-stone-200 bg-stone-100/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden ${
          keyboardOpen ? 'hidden' : ''
        }`}
      >
        {mobileNav.map(({ to, label, icon: Icon, activeOptions }) => {
          const tab =
            'flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-transform active:scale-90 active:text-brand-700'
          return (
            <Link
              key={to}
              to={to}
              preload="render"
              className={`${tab} text-stone-500`}
              activeProps={{ className: `${tab} text-brand-700` }}
              activeOptions={activeOptions}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

function PendingInvites() {
  const queryClient = useQueryClient()
  const { data: invites } = useSuspenseQuery(pendingInvitesQueryOptions())

  const refreshAfterShareChange = () => {
    queryClient.invalidateQueries({ queryKey: pendingInvitesQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: sharingQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: recipesQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })
  }

  const accept = useMutation({
    mutationFn: (id: string) => acceptInvite({ data: id }),
    onSuccess: refreshAfterShareChange,
  })
  const decline = useMutation({
    mutationFn: (id: string) => declineInvite({ data: id }),
    onSuccess: refreshAfterShareChange,
  })

  if (invites.length === 0) return null

  return (
    <div className="mb-6 flex flex-col gap-3">
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3"
        >
          <UserPlus className="h-5 w-5 shrink-0 text-brand-600" />
          <p className="flex-1 text-sm text-stone-700">
            <strong>{invite.fromName || invite.fromEmail}</strong> vil dele
            oppskrifter og handleliste med deg.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              isDisabled={accept.isPending}
              onPress={() => accept.mutate(invite.id)}
            >
              Godta
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={decline.isPending}
              onPress={() => decline.mutate(invite.id)}
            >
              Avslå
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
