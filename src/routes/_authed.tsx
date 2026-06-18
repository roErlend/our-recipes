import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { ChefHat, ListChecks, LogOut, UtensilsCrossed } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { signOut } from '@/lib/auth-client'
import { fetchSession } from '@/server/auth'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async () => {
    const session = await fetchSession()
    if (!session?.user) {
      throw redirect({ to: '/login' })
    }
    return { user: session.user }
  },
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

          <nav className="flex items-center gap-1">
            <Link
              to="/recipes"
              className={navLinkClass}
              activeProps={{ className: `${navLinkClass} ${activeNavLinkClass}` }}
              activeOptions={{ exact: false }}
            >
              <ChefHat className="h-4 w-4" />
              Oppskrifter
            </Link>
            <Link
              to="/shopping"
              className={navLinkClass}
              activeProps={{ className: `${navLinkClass} ${activeNavLinkClass}` }}
            >
              <ListChecks className="h-4 w-4" />
              Handleliste
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
        <Outlet />
      </main>
    </div>
  )
}
