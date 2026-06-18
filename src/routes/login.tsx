import { useState } from 'react'
import { Form } from 'react-aria-components'
import {
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { UtensilsCrossed } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { signIn, signUp } from '@/lib/auth-client'
import { fetchSession } from '@/server/auth'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const session = await fetchSession()
    if (session?.user) {
      throw redirect({ to: '/recipes' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)

    const data = new FormData(e.currentTarget)
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const name = String(data.get('name') ?? '')

    const result =
      mode === 'signup'
        ? await signUp.email({ email, password, name: name || email })
        : await signIn.email({ email, password })

    setPending(false)

    if (result.error) {
      setError(result.error.message ?? 'Noe gikk galt')
      return
    }

    await router.invalidate()
    router.navigate({ to: '/recipes' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white">
            <UtensilsCrossed className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-stone-900">
            Våre oppskrifter
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {mode === 'signin'
              ? 'Logg inn på deres felles oppskriftsbok'
              : 'Opprett en konto for å komme i gang'}
          </p>
        </div>

        <Form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
        >
          {mode === 'signup' && (
            <TextField name="name" label="Navn" placeholder="Navnet ditt" />
          )}
          <TextField
            name="email"
            type="email"
            label="E-post"
            placeholder="deg@eksempel.no"
            isRequired
            autoComplete="email"
          />
          <TextField
            name="password"
            type="password"
            label="Passord"
            placeholder="••••••••"
            isRequired
            autoComplete={
              mode === 'signin' ? 'current-password' : 'new-password'
            }
          />

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" isDisabled={pending}>
            {pending
              ? 'Vent litt…'
              : mode === 'signin'
                ? 'Logg inn'
                : 'Opprett konto'}
          </Button>
        </Form>

        <p className="mt-4 text-center text-sm text-stone-500">
          {mode === 'signin'
            ? 'Har du ikke en konto? '
            : 'Har du allerede en konto? '}
          <button
            type="button"
            className="cursor-pointer font-medium text-brand-700 hover:underline"
            onClick={() => {
              setError(null)
              setMode(mode === 'signin' ? 'signup' : 'signin')
            }}
          >
            {mode === 'signin' ? 'Registrer deg' : 'Logg inn'}
          </button>
        </p>
      </div>
    </div>
  )
}
