'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { completeClaim } from '@/actions/claim'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Building2 } from 'lucide-react'
import type { ClaimPreview } from '@/actions/claim'

interface Props {
  token: string
  preview: ClaimPreview
  userEmail: string | null
}

export function ClaimForm({ token, preview, userEmail }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Surface a soft warning (not block) when the signed-in user's email
  // doesn't match the listing's invite email. Could be intentional —
  // the invite was sent to the work email but they signed up with a
  // personal one. Admin can resolve via /admin/listings if there's a
  // mismatch problem later.
  const emailMismatch = userEmail && preview.email && userEmail.toLowerCase() !== preview.email.toLowerCase()

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const res = await completeClaim(token)
      if (res.error) { setError(res.error); return }
      // Land on the listing they just claimed so they can edit it.
      router.push(`/dashboard/business/edit/${res.business_id}`)
    })
  }

  const subtitle = [preview.city, preview.country].filter(Boolean).join(', ')

  return (
    <div className="bg-card border border-border rounded-xl p-8 space-y-5">
      <div>
        <h1 className="text-xl font-bold mb-1">Claim this listing</h1>
        <p className="text-sm text-muted-foreground">
          Confirm to take ownership. You&apos;ll land on the edit page so you can add services, update the description, and customise it.
        </p>
      </div>

      <div className="bg-muted/30 border border-border rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold">{preview.name}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            {preview.email && (
              <p className="text-xs text-muted-foreground mt-1">
                Invited at: <span className="text-foreground">{preview.email}</span>
              </p>
            )}
            {preview.description && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-3">{preview.description}</p>
            )}
          </div>
        </div>
      </div>

      {emailMismatch && (
        <Alert>
          <AlertDescription>
            <p className="text-sm">
              <strong>Heads up:</strong> the invite was sent to <span className="font-mono">{preview.email}</span>,
              but you&apos;re signed in as <span className="font-mono">{userEmail}</span>. If that&apos;s intentional
              (e.g., you use a personal email for member market), continue. Otherwise sign in with the invited
              account first.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={isPending} className="flex-1">
          {isPending ? 'Claiming…' : 'Claim listing'}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        After claiming, your listing remains tagged Unverified until you complete verification at{' '}
        <span className="font-mono">/dashboard/verify</span>.
      </p>
    </div>
  )
}
