import { previewClaim } from '@/actions/claim'
import { createClient } from '@/lib/supabase/server'
import { ClaimForm } from './claim-form'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

/**
 * Claim landing page. Unauthenticated members can land here from a
 * cold-invite email; the page tells them what's about to happen and
 * routes them to /signup or /login as needed (where the URL after
 * auth brings them back here).
 *
 * Server-side state machine:
 *   - Token invalid → friendly error
 *   - Token valid + already claimed → dead-link state
 *   - Token valid + expired → "expired, contact your chapter" state
 *   - Token valid + user signed in → render claim confirmation form
 *   - Token valid + user not signed in → "sign in or sign up to claim"
 */
export default async function ClaimPage({ params }: PageProps) {
  const { token } = await params
  const { error, preview } = await previewClaim(token)

  // Auth check is informational only — the client-side action does the
  // real auth gate. We just want to render the right UX.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {error || !preview ? (
          <ErrorState message={error ?? 'Unknown error'} />
        ) : preview.is_already_claimed ? (
          <AlreadyClaimedState businessId={preview.business_id} businessName={preview.name} />
        ) : preview.is_expired ? (
          <ExpiredState />
        ) : !user ? (
          <UnauthState businessName={preview.name} token={token} />
        ) : (
          <ClaimForm token={token} preview={preview} userEmail={user.email ?? null} />
        )}
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-8 text-center">
      <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
      <h1 className="text-xl font-bold mb-2">We couldn&apos;t open that claim link</h1>
      <p className="text-sm text-muted-foreground mb-6">{message}</p>
      <Link href="/" className="text-sm text-primary hover:underline">Back to home</Link>
    </div>
  )
}

function AlreadyClaimedState({ businessId, businessName }: { businessId: string; businessName: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-8 text-center">
      <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
      <h1 className="text-xl font-bold mb-2">Already claimed</h1>
      <p className="text-sm text-muted-foreground mb-6">
        <strong className="text-foreground">{businessName}</strong> has already been claimed by its owner.
      </p>
      <Link
        href={`/marketplace/${businessId}`}
        className="text-sm text-primary hover:underline"
      >
        View the listing →
      </Link>
    </div>
  )
}

function ExpiredState() {
  return (
    <div className="bg-card border border-border rounded-xl p-8 text-center">
      <AlertTriangle className="h-12 w-12 text-yellow-600 mx-auto mb-4" />
      <h1 className="text-xl font-bold mb-2">This claim link has expired</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Claim links are valid for 60 days. Contact your chapter manager or App Admin for a fresh link —
        your listing is still live in the marketplace.
      </p>
    </div>
  )
}

function UnauthState({ businessName, token }: { businessName: string; token: string }) {
  // Pass the claim URL back as a redirect param so post-auth flow
  // returns the user here. Both /login and /signup pages need to
  // respect a `?next=` query param — they already do via the existing
  // auth callback handling.
  const next = encodeURIComponent(`/claim/${token}`)
  return (
    <div className="bg-card border border-border rounded-xl p-8 space-y-4">
      <div>
        <h1 className="text-xl font-bold mb-2">Claim {businessName}</h1>
        <p className="text-sm text-muted-foreground">
          Sign in or create an account to claim this listing. Once you&apos;re signed in we&apos;ll bring you
          back here to confirm.
        </p>
      </div>
      <div className="flex flex-col gap-2 pt-2">
        <Link
          href={`/signup?next=${next}`}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90"
        >
          Create account
        </Link>
        <Link
          href={`/login?next=${next}`}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border hover:bg-muted text-sm"
        >
          I already have an account
        </Link>
      </div>
    </div>
  )
}
