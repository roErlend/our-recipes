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
import { ChefHat, ListChecks, LogOut, UserPlus, UtensilsCrossed } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { signOut } from '@/lib/auth-client'
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
  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition-colors',
  'hover:bg-stone-200/60 hover:text-stone-900',
].join(' ')

const activeNavLinkClass = 'bg-white text-brand-700 shadow-sm hover:bg-white'

function AuthedLayout() {
  const { user } = Route.useRouteContext()
  const router = useRouter()

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
            to="/recipes"
            className="mr-2 inline-flex items-center gap-2 text-lg font-bold text-stone-900"
          >
            <UtensilsCrossed className="h-5 w-5 text-brand-600" />
            Våre oppskrifter
          </Link>

          {/* preload="render" warms each section's code + data in the
              background right after the nav mounts, so switching between the
              three pages is instant once warmed (helps most on slow/distant
              hosting where on-hover intent preload doesn't finish in time). */}
          <nav className="flex items-center gap-1">
            <Link
              to="/recipes"
              preload="render"
              className={navLinkClass}
              activeProps={{ className: `${navLinkClass} ${activeNavLinkClass}` }}
              activeOptions={{ exact: false }}
            >
              <ChefHat className="h-4 w-4" />
              Oppskrifter
            </Link>
            <Link
              to="/shopping"
              preload="render"
              className={navLinkClass}
              activeProps={{ className: `${navLinkClass} ${activeNavLinkClass}` }}
            >
              <ListChecks className="h-4 w-4" />
              Handleliste
            </Link>
            <Link
              to="/deling"
              preload="render"
              className={navLinkClass}
              activeProps={{ className: `${navLinkClass} ${activeNavLinkClass}` }}
            >
              <UserPlus className="h-4 w-4" />
              Deling
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-stone-500 sm:inline">
              {user.name || user.email}
            </span>
            <Button variant="ghost" size="sm" onPress={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Logg ut
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <PendingInvites />
        <Outlet />
      </main>
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
