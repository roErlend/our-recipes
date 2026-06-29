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
import { sendVerificationEmail, signIn, signUp } from '@/lib/auth-client'
import { fetchSession } from '@/server/auth'

/** Where the verification link drops people once they confirm. */
const VERIFY_CALLBACK = '/recipes'

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
  // When set, we've sent a verification link to this address and show the
  // "check your inbox" panel instead of the form.
  const [awaitingVerification, setAwaitingVerification] = useState<string | null>(
    null,
  )
  const [resendNote, setResendNote] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)

    const data = new FormData(e.currentTarget)
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const name = String(data.get('name') ?? '')

    if (mode === 'signup') {
      const result = await signUp.email({
        email,
        password,
        name: name || email,
        callbackURL: VERIFY_CALLBACK,
      })
      setPending(false)
      if (result.error) {
        setError(result.error.message ?? 'Noe gikk galt')
        return
      }
      // Account created but not yet usable — verification gates sign-in.
      setAwaitingVerification(email)
      return
    }

    const result = await signIn.email({ email, password })
    setPending(false)

    if (result.error) {
      // Unverified accounts are blocked here; better-auth re-sends the link.
      if (result.error.code === 'EMAIL_NOT_VERIFIED') {
        setAwaitingVerification(email)
        return
      }
      setError(result.error.message ?? 'Noe gikk galt')
      return
    }

    await router.invalidate()
    router.navigate({ to: '/recipes' })
  }

  async function resend() {
    if (!awaitingVerification) return
    setResendNote(null)
    const result = await sendVerificationEmail({
      email: awaitingVerification,
      callbackURL: VERIFY_CALLBACK,
    })
    setResendNote(
      result.error
        ? (result.error.message ?? 'Kunne ikke sende på nytt')
        : 'Sendt på nytt – sjekk innboksen.',
    )
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

        {awaitingVerification ? (
          <div className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-900">
              Sjekk e-posten din
            </h2>
            <p className="text-sm text-stone-600">
              Vi har sendt en bekreftelseslenke til{' '}
              <strong className="text-stone-900">{awaitingVerification}</strong>.
              Klikk lenken for å aktivere kontoen og logge inn.
            </p>
            {resendNote && (
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
                {resendNote}
              </p>
            )}
            <Button variant="secondary" onPress={resend}>
              Send lenken på nytt
            </Button>
            <button
              type="button"
              className="cursor-pointer text-center text-sm font-medium text-brand-700 hover:underline"
              onClick={() => {
                setAwaitingVerification(null)
                setResendNote(null)
                setError(null)
                setMode('signin')
              }}
            >
              Tilbake til innlogging
            </button>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  )
}
