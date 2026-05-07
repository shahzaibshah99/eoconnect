import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle2, Clock, RotateCcw, XCircle } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  VERIFICATION_TAG_LABEL,
  type VerificationTag,
} from '@/lib/verification-tags'
import { VerificationSubmissionForm } from '@/components/auth/verification-submission-form'
import { currentTenant } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

type Status = 'pending' | 'approved' | 'rejected' | 'resubmit'

interface LatestVerification {
  id: string
  status: Status
  rejection_reason: string | null
  reviewed_at: string | null
  created_at: string
  screenshot_url: string | null
  linkedin_url: string | null
}

/**
 * Member-facing verification page. State-driven UI:
 *
 *   already verified  → show tag, link onward
 *   pending           → "Awaiting admin review" state, show submission summary
 *   resubmit          → show admin's note, allow new submission
 *   rejected          → show admin's reason, allow new submission
 *   no row            → submission form
 */
export default async function VerifyMembershipPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await db
    .from('profiles')
    .select('verification_tag, tenant_id, full_name')
    .eq('id', user.id)
    .single() as { data: { verification_tag: VerificationTag; tenant_id: string; full_name: string | null } | null }

  // Latest verification row regardless of status — drives the state UI.
  const { data: latest } = await db
    .from('verifications')
    .select('id, status, rejection_reason, reviewed_at, created_at, screenshot_url, linkedin_url')
    .eq('member_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: LatestVerification | null }

  const tag = profile?.verification_tag ?? 'unverified'
  const isVerified = tag !== 'unverified'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Verify your membership</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Submit a screenshot of your EO or YPO member profile page. An admin reviews and assigns your verification tag.
        </p>
      </header>

      {isVerified ? (
        <VerifiedState tag={tag} />
      ) : latest?.status === 'pending' ? (
        <PendingState row={latest} />
      ) : (
        <SubmitState
          previous={latest}
          tenantId={profile?.tenant_id ?? currentTenant()}
        />
      )}

      <TrustNotes />
    </div>
  )
}

function VerifiedState({ tag }: { tag: VerificationTag }) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-3">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6 text-green-600" />
        <h2 className="font-semibold">You&apos;re verified</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Your member profile carries the{' '}
        <Badge variant="secondary">{VERIFICATION_TAG_LABEL[tag]}</Badge>{' '}
        tag. Listings you publish inherit the tag and get tier-based search ranking.
      </p>
      <div className="pt-2 flex gap-2">
        <Link href="/dashboard" className="text-sm text-primary hover:underline">
          Back to dashboard →
        </Link>
      </div>
    </div>
  )
}

function PendingState({ row }: { row: LatestVerification }) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-3">
      <div className="flex items-center gap-3">
        <Clock className="h-6 w-6 text-yellow-600" />
        <h2 className="font-semibold">Awaiting admin review</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Submitted {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}.
        We&apos;ll email you when an admin reviews your submission. Most are reviewed within a few business days.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
        {row.screenshot_url && (
          <div className="text-xs">
            <p className="text-muted-foreground mb-1">Screenshot</p>
            <a href={row.screenshot_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              View what you submitted
            </a>
          </div>
        )}
        {row.linkedin_url && (
          <div className="text-xs min-w-0">
            <p className="text-muted-foreground mb-1">LinkedIn</p>
            <a
              href={row.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline truncate block"
              title={row.linkedin_url}
            >
              {row.linkedin_url}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function SubmitState({ previous, tenantId }: { previous: LatestVerification | null; tenantId: string }) {
  return (
    <div className="space-y-4">
      {previous?.status === 'rejected' && previous.rejection_reason && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            <span className="font-medium">Previous submission rejected</span>
            {previous.reviewed_at && (
              <span className="text-xs ml-2 opacity-80">
                {format(new Date(previous.reviewed_at), 'MMM d, yyyy')}
              </span>
            )}
            <p className="mt-1 text-sm">{previous.rejection_reason}</p>
          </AlertDescription>
        </Alert>
      )}
      {previous?.status === 'resubmit' && previous.rejection_reason && (
        <Alert>
          <RotateCcw className="h-4 w-4" />
          <AlertDescription>
            <span className="font-medium">Admin requested an updated submission</span>
            <p className="mt-1 text-sm">{previous.rejection_reason}</p>
          </AlertDescription>
        </Alert>
      )}
      <VerificationSubmissionForm tenantId={tenantId} />
    </div>
  )
}

function TrustNotes() {
  return (
    <div className="text-xs text-muted-foreground space-y-1.5 pt-2 border-t border-border">
      <p>
        <strong className="text-foreground">What we accept:</strong>{' '}
        A screenshot of your EO or YPO member network profile page showing your name and chapter. Crop sensitive personal info if you wish — the admin only needs to see the membership signal.
      </p>
      <p>
        <strong className="text-foreground">LinkedIn:</strong>{' '}
        Optional. We&apos;ll use your LinkedIn page as a supporting signal. We never auto-approve based on LinkedIn alone — a human admin always reviews.
      </p>
    </div>
  )
}
