import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ShieldCheck, Building2, ChevronRight, Clock, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function GetStartedPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: verification }, { data: businesses }] = await Promise.all([
    db.from('profiles').select('full_name, verification_tag, eo_membership_email').eq('id', user.id).maybeSingle() as Promise<{
      data: { full_name: string | null; verification_tag: string; eo_membership_email: string | null } | null
    }>,
    db.from('verifications').select('status, created_at').eq('member_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle() as Promise<{
      data: { status: string; created_at: string } | null
    }>,
    db.from('businesses').select('id').eq('owner_id', user.id).limit(1) as Promise<{
      data: Array<{ id: string }> | null
    }>,
  ])

  // Separate query for pending claim — inline cast to known shape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingClaimRaw: any = await db.from('businesses').select('id, name, claim_token')
    .eq('is_pre_populated', true)
    .is('owner_id', null)
    .ilike('email', user.email ?? '')
    .not('claim_token', 'is', null)
    .limit(1)
    .maybeSingle()
  const pendingClaimName: string | null = pendingClaimRaw?.data?.name ?? null
  const pendingClaimToken: string | null = pendingClaimRaw?.data?.claim_token ?? null

  const isVerified = profile?.verification_tag && profile.verification_tag !== 'unverified'
  const hasBusiness = (businesses ?? []).length > 0
  const hasPendingClaim = !!pendingClaimToken
  const verificationPending = verification?.status === 'pending'

  // If they've already done both steps, send them to the dashboard.
  if (isVerified && hasBusiness) redirect('/dashboard')

  // If there's a pre-populated listing waiting for their email,
  // send them straight to the claim page — skip the two-step flow entirely.
  if (hasPendingClaim && pendingClaimToken) redirect(`/claim/${pendingClaimToken}`)

  const name = profile?.full_name?.split(' ')[0] ?? 'there'

  return (
    <div className="max-w-xl mx-auto space-y-8 py-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Welcome, {name} 👋</h1>
        <p className="text-muted-foreground mt-1.5">
          Two quick steps to get your business listed on Member Market.
        </p>
      </div>

      {/* Pending claim banner — shown when a pre-populated listing is
          waiting for this user's email to be claimed. */}
      {hasPendingClaim && pendingClaimToken && (
        <div className="rounded-2xl border-2 border-primary bg-primary/5 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Your listing is waiting to be claimed</p>
            <p className="text-sm text-muted-foreground mt-1">
              {pendingClaimName && <strong>{pendingClaimName}</strong>} was pre-created for you. Claim it to take ownership — no need to create a new listing.
            </p>
          </div>
          <Link
            href={`/claim/${pendingClaimToken}`}
            className={cn(buttonVariants(), 'shrink-0 gap-2')}
          >
            Claim your listing →
          </Link>
        </div>
      )}

      {/* Step 1 — Verify */}
      <div className={cn(
        'rounded-2xl border p-6 space-y-4',
        isVerified
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-primary/30 bg-primary/5 ring-2 ring-primary/20'
      )}>
        <div className="flex items-start gap-4">
          <div className={cn(
            'h-10 w-10 rounded-full flex items-center justify-center shrink-0 font-bold text-lg',
            isVerified ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground'
          )}>
            {isVerified ? <CheckCircle2 className="h-5 w-5" /> : '1'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold text-lg">Verify your EO membership</h2>
              {isVerified && (
                <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 border text-[10px]">
                  Verified
                </Badge>
              )}
              {verificationPending && !isVerified && (
                <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30 border text-[10px] gap-1">
                  <Clock className="h-3 w-3" /> Under review
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              Upload a screenshot of your EO member profile page. An admin reviews it within a few business days.
              Verified members rank higher in search and unlock posting, endorsing, and messaging.
            </p>
          </div>
        </div>

        {!isVerified && (
          <div className="pl-14 space-y-3">
            {/* Benefits list */}
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {[
                'Higher search ranking in the marketplace',
                'Post business needs on the bulletin board',
                'Endorse and message fellow members',
                'Trusted "EO Member" badge on your listing',
              ].map(benefit => (
                <li key={benefit} className="flex items-start gap-2">
                  <ChevronRight className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                  {benefit}
                </li>
              ))}
            </ul>

            {verificationPending ? (
              <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
                Your submission is being reviewed. We&apos;ll email you when it&apos;s approved.
                <Link href="/dashboard/verify" className="ml-2 underline underline-offset-2 font-medium">
                  View status
                </Link>
              </div>
            ) : (
              <Link
                href="/dashboard/verify"
                className={cn(buttonVariants(), 'gap-2 w-full sm:w-auto')}
              >
                <ShieldCheck className="h-4 w-4" />
                Verify membership now
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Step 2 — Create listing */}
      <div className={cn(
        'rounded-2xl border p-6 space-y-4',
        hasBusiness
          ? 'border-green-500/30 bg-green-500/5'
          : isVerified
            ? 'border-primary/30 bg-primary/5 ring-2 ring-primary/20'
            : 'border-border bg-muted/30 opacity-60'
      )}>
        <div className="flex items-start gap-4">
          <div className={cn(
            'h-10 w-10 rounded-full flex items-center justify-center shrink-0 font-bold text-lg',
            hasBusiness
              ? 'bg-green-500 text-white'
              : isVerified
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground border border-border'
          )}>
            {hasBusiness ? <CheckCircle2 className="h-5 w-5" /> : '2'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold text-lg">Create your business listing</h2>
              {hasBusiness && (
                <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 border text-[10px]">
                  Listed
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              Add your business, services, and contact details so fellow EO members can discover and reach you.
            </p>
          </div>
        </div>

        {!hasBusiness && (
          <div className="pl-14">
            <Link
              href="/dashboard/business/new"
              className={cn(
                buttonVariants({ variant: isVerified ? 'default' : 'outline' }),
                'gap-2 w-full sm:w-auto',
                !isVerified && 'pointer-events-none opacity-50'
              )}
              aria-disabled={!isVerified}
              tabIndex={isVerified ? undefined : -1}
            >
              <Building2 className="h-4 w-4" />
              {isVerified ? 'Create listing' : 'Verify first to unlock'}
            </Link>
            {!isVerified && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Complete step 1 first. You can create a listing immediately after verifying.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Already have a listing? Skip to dashboard */}
      {hasBusiness && !isVerified && (
        <div className="text-center">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2">
            Go to dashboard while I wait for verification
          </Link>
        </div>
      )}
    </div>
  )
}
