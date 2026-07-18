import { useState } from 'react'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Form } from 'react-aria-components'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Mail, UserMinus, UserPlus, Users, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import {
  pendingInvitesQueryOptions,
  recipesQueryOptions,
  sharingQueryOptions,
  shoppingQueryOptions,
} from '@/lib/queries'
import {
  acceptInvite,
  cancelInvite,
  declineInvite,
  leaveHousehold,
  removeHouseholdMember,
  sendInvite,
} from '@/server/sharing'

export const Route = createFileRoute('/_authed/deling')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(sharingQueryOptions()),
  component: SharingPage,
})

function SharingPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(sharingQueryOptions())
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Two-click confirm before anyone leaves the household. `confirmingRemove`
  // holds the member id mid-confirm; `confirmingLeave` is for leaving myself.
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null)
  const [confirmingLeave, setConfirmingLeave] = useState(false)

  const sharingKey = sharingQueryOptions().queryKey
  const invalidateSharing = () =>
    queryClient.invalidateQueries({ queryKey: sharingKey })
  const invalidateAll = () => {
    invalidateSharing()
    queryClient.invalidateQueries({ queryKey: pendingInvitesQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: recipesQueryOptions().queryKey })
    queryClient.invalidateQueries({ queryKey: shoppingQueryOptions().queryKey })
  }

  const invite = useMutation({
    mutationFn: (value: string) => sendInvite({ data: value }),
    onSuccess: () => {
      setEmail('')
      setError(null)
      invalidateSharing()
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Kunne ikke sende invitasjon'),
  })
  const cancel = useMutation({
    mutationFn: (value: string) => cancelInvite({ data: value }),
    onSuccess: invalidateSharing,
  })
  const accept = useMutation({
    mutationFn: (id: string) => acceptInvite({ data: id }),
    onSuccess: invalidateAll,
  })
  const decline = useMutation({
    mutationFn: (id: string) => declineInvite({ data: id }),
    onSuccess: invalidateAll,
  })
  const leave = useMutation({
    mutationFn: () => leaveHousehold(),
    onSuccess: () => {
      setConfirmingLeave(false)
      invalidateAll()
    },
  })
  const remove = useMutation({
    mutationFn: (userId: string) => removeHouseholdMember({ data: userId }),
    onSuccess: () => {
      setConfirmingRemove(null)
      invalidateAll()
    },
  })
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Deling</h1>
        <p className="text-sm text-stone-500">
          Del oppskriftene og handlelisten din med noen. Når de godtar, kan dere
          begge administrere alt sammen.
        </p>
      </div>

      {/* Invites waiting for me */}
      {data.pendingForMe.length > 0 && (
        <Section title="Invitasjoner til deg">
          <ul className="flex flex-col gap-2">
            {data.pendingForMe.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm"
              >
                <span className="flex-1">
                  <strong>{inv.fromName || inv.fromEmail}</strong> vil dele med
                  deg
                </span>
                <Button size="sm" onPress={() => accept.mutate(inv.id)}>
                  <Check className="h-4 w-4" />
                  Godta
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => decline.mutate(inv.id)}
                >
                  Avslå
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* People I share with */}
      <Section
        title="Deler med"
        icon={<Users className="h-4 w-4 text-stone-400" />}
      >
        {data.householdMembers.length === 0 ? (
          <p className="text-sm text-stone-500">
            Du deler ikke med noen ennå.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.householdMembers.map((m) => {
              const confirming = confirmingRemove === m.id
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
                >
                  <span className="flex-1">
                    <span className="font-medium text-stone-900">{m.name}</span>{' '}
                    <span className="text-stone-400">{m.email}</span>
                  </span>
                  {confirming ? (
                    <>
                      <span className="text-stone-600">
                        Slutte å dele med {m.name}?
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        isDisabled={remove.isPending}
                        onPress={() => remove.mutate(m.id)}
                      >
                        {remove.isPending ? 'Fjerner…' : 'Bekreft'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={remove.isPending}
                        onPress={() => setConfirmingRemove(null)}
                      >
                        Avbryt
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600"
                      aria-label={`Slutt å dele med ${m.name}`}
                      onPress={() => {
                        setConfirmingLeave(false)
                        setConfirmingRemove(m.id)
                      }}
                    >
                      <UserMinus className="h-4 w-4" />
                      Fjern
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {data.householdMembers.length > 0 &&
          (confirmingLeave ? (
            <div className="flex flex-wrap items-center gap-2 self-start text-sm">
              <span className="text-stone-600">
                Forlate husholdningen? Du slutter å dele med alle.
              </span>
              <Button
                size="sm"
                variant="danger"
                isDisabled={leave.isPending}
                onPress={() => leave.mutate()}
              >
                {leave.isPending ? 'Forlater…' : 'Bekreft'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={leave.isPending}
                onPress={() => setConfirmingLeave(false)}
              >
                Avbryt
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-red-600"
              onPress={() => {
                setConfirmingRemove(null)
                setConfirmingLeave(true)
              }}
            >
              <UserMinus className="h-4 w-4" />
              Slutt å dele
            </Button>
          ))}
      </Section>

      {/* Invite someone */}
      <Section
        title="Inviter noen"
        icon={<UserPlus className="h-4 w-4 text-stone-400" />}
      >
        <Form
          onSubmit={(e) => {
            e.preventDefault()
            if (email.trim()) invite.mutate(email.trim())
          }}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <TextField
              label="E-post"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="partner@eksempel.no"
            />
          </div>
          <Button type="submit" isDisabled={invite.isPending}>
            <Mail className="h-4 w-4" />
            Send invitasjon
          </Button>
        </Form>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-stone-400">
          Ingen e-post sendes — personen ser invitasjonen når de logger inn.
        </p>

        {data.sentInvites.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-xs font-medium text-stone-500">
              Sendte invitasjoner
            </p>
            <ul className="flex flex-col gap-2">
              {data.sentInvites.map((toEmail) => (
                <li
                  key={toEmail}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm"
                >
                  <span className="flex-1 text-stone-600">{toEmail}</span>
                  <span className="text-xs text-stone-400">venter</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Trekk tilbake invitasjon til ${toEmail}`}
                    onPress={() => cancel.mutate(toEmail)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

    </div>
  )
}

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
