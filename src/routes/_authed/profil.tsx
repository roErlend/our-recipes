import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Form } from 'react-aria-components'
import { KeyRound, Trash2, UserCircle } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { UserAvatar } from '@/components/UserAvatar'
import { changePassword, signOut, updateUser } from '@/lib/auth-client'
import { deleteAccount } from '@/server/account'

export const Route = createFileRoute('/_authed/profil')({
  component: ProfilePage,
})

function ProfilePage() {
  const { user } = Route.useRouteContext()
  const router = useRouter()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <UserAvatar name={user.name} email={user.email} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-stone-900">
            {user.name || user.email}
          </h1>
          <p className="truncate text-sm text-stone-500">{user.email}</p>
        </div>
      </div>

      <NameSection initialName={user.name ?? ''} />
      <PasswordSection />
      <DangerZone onDeleted={async () => {
        // Session rows were cascade-deleted; sign-out is best-effort cleanup.
        await signOut().catch(() => {})
        await router.invalidate()
        router.navigate({ to: '/login' })
      }} />
    </div>
  )
}

/* -------------------------------- name ---------------------------------- */

function NameSection({ initialName }: { initialName: string }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await updateUser({ name: name.trim() })
      if (error) throw new Error(error.message ?? 'Kunne ikke lagre navnet')
    },
    onSuccess: async () => {
      setSaved(true)
      // The name shows up in the header, ratings and sharing — refresh the
      // session context and everything cached.
      await router.invalidate()
      queryClient.invalidateQueries()
    },
  })

  const dirty = name.trim() !== initialName && name.trim() !== ''

  return (
    <Section
      title="Profil"
      icon={<UserCircle className="h-4 w-4 text-stone-400" />}
    >
      <Form
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty) save.mutate()
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <TextField
            label="Navn"
            value={name}
            onChange={(v) => {
              setName(v)
              setSaved(false)
            }}
            maxLength={100}
            autoComplete="name"
            placeholder="Kari Nordmann"
          />
        </div>
        <Button type="submit" isDisabled={!dirty || save.isPending}>
          {save.isPending ? 'Lagrer…' : 'Lagre'}
        </Button>
      </Form>
      {save.isError && (
        <p className="text-sm text-red-600">
          {save.error instanceof Error ? save.error.message : 'Noe gikk galt'}
        </p>
      )}
      {saved && !dirty && (
        <p className="text-sm text-brand-700">Navnet er lagret.</p>
      )}
    </Section>
  )
}

/* ------------------------------- password -------------------------------- */

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const change = useMutation({
    mutationFn: async () => {
      const { error: err } = await changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      })
      if (err) {
        throw new Error(
          err.code === 'INVALID_PASSWORD'
            ? 'Feil nåværende passord'
            : (err.message ?? 'Kunne ikke bytte passord'),
        )
      }
    },
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setRepeat('')
      setError(null)
      setDone(true)
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Kunne ikke bytte passord'),
  })

  const submit = () => {
    setDone(false)
    if (next.length < 8) {
      setError('Nytt passord må ha minst 8 tegn')
      return
    }
    if (next !== repeat) {
      setError('Passordene er ikke like')
      return
    }
    setError(null)
    change.mutate()
  }

  const canSubmit = current !== '' && next !== '' && repeat !== ''

  return (
    <Section
      title="Bytt passord"
      icon={<KeyRound className="h-4 w-4 text-stone-400" />}
    >
      <Form
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) submit()
        }}
        className="flex max-w-md flex-col gap-3"
      >
        <TextField
          label="Nåværende passord"
          type="password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <TextField
          label="Nytt passord"
          type="password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          description="Minst 8 tegn"
        />
        <TextField
          label="Gjenta nytt passord"
          type="password"
          value={repeat}
          onChange={setRepeat}
          autoComplete="new-password"
        />
        <Button
          type="submit"
          isDisabled={!canSubmit || change.isPending}
          className="self-start"
        >
          {change.isPending ? 'Bytter…' : 'Bytt passord'}
        </Button>
      </Form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {done && !error && (
        <p className="text-sm text-brand-700">
          Passordet er byttet. Andre innloggede enheter er logget ut.
        </p>
      )}
    </Section>
  )
}

/* ------------------------------ danger zone ------------------------------ */

/** Account deletion — irreversible, so it lives in its own marked-off zone. */
function DangerZone({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)

  const deleteAcct = useMutation({
    mutationFn: () => deleteAccount(),
    onSuccess: onDeleted,
  })

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/40 p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-red-700">
        <Trash2 className="h-4 w-4 text-red-500" />
        Faresone
      </h2>
      <p className="text-sm text-stone-600">
        Sletter kontoen din og alt du eier — oppskriftene dine, vurderinger og
        innstillinger. Deler du med noen, forsvinner oppskriftene du eier også
        for dem. Dette kan ikke angres.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-stone-700">
            Helt sikker? Kontoen og dataene slettes for godt.
          </span>
          <Button
            variant="danger"
            size="sm"
            isDisabled={deleteAcct.isPending}
            onPress={() => deleteAcct.mutate()}
          >
            <Trash2 className="h-4 w-4" />
            {deleteAcct.isPending ? 'Sletter…' : 'Slett kontoen min'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={deleteAcct.isPending}
            onPress={() => setConfirming(false)}
          >
            Avbryt
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-red-600"
          onPress={() => setConfirming(true)}
        >
          <Trash2 className="h-4 w-4" />
          Slett kontoen min
        </Button>
      )}
      {deleteAcct.isError && (
        <p className="text-sm text-red-600">
          Kunne ikke slette kontoen. Prøv igjen.
        </p>
      )}
    </section>
  )
}

/* -------------------------------- shared --------------------------------- */

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  )
}
