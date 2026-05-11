import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TermsAcceptForm } from './terms-accept-form'
import { CURRENT_TERMS_VERSION } from '@/lib/terms-constants'

export const dynamic = 'force-dynamic'

/**
 * T&C acceptance wall. Per scope F06: first login → cannot skip.
 * Acceptance is timestamped + versioned. Re-shown when terms are
 * updated (CURRENT_TERMS_VERSION bumped).
 *
 * Layout: uses (auth) centred layout (same as login/signup).
 * After accepting, the action revalidates the root layout so the
 * (app) layout's intercept clears and the user lands on /dashboard.
 */
export default async function TermsAcceptPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: profile } = await db
    .from('profiles')
    .select('terms_version')
    .eq('id', user.id)
    .single() as { data: { terms_version: number | null } | null }

  // Already accepted the current version — no reason to be here.
  if ((profile?.terms_version ?? 0) >= CURRENT_TERMS_VERSION) {
    redirect('/dashboard')
  }

  return (
    <div className="w-full max-w-lg">
      <div className="bg-card border border-border rounded-xl p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Terms of use</h1>
          <p className="text-sm text-muted-foreground">
            Review and accept before continuing.
          </p>
        </div>

        {/* Key terms summary — non-solicitation is the critical clause */}
        <div className="bg-muted/40 border border-border rounded-lg p-4 space-y-3 text-sm">
          <p className="font-semibold">By using Member Market you agree to:</p>
          <ul className="space-y-2 text-muted-foreground list-disc pl-4">
            <li>
              <strong className="text-foreground">Non-solicitation</strong> — you will not cold-pitch,
              spam, or unsolicited-sell to other members. Inquiries must be genuine expressions
              of interest in a service or product you have viewed.
            </li>
            <li>
              <strong className="text-foreground">Accurate representation</strong> — your business
              listing, services, and member information must be truthful.
            </li>
            <li>
              <strong className="text-foreground">Respectful conduct</strong> — no harassment,
              discrimination, or inappropriate content.
            </li>
            <li>
              <strong className="text-foreground">EO / YPO membership</strong> — you confirm that
              the membership information you submit for verification is accurate.
            </li>
          </ul>
          <p className="text-xs text-muted-foreground pt-1">
            Violations may result in a warning, suspension, or permanent ban.{' '}
            <Link href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline">
              Read the full terms →
            </Link>
          </p>
        </div>

        <TermsAcceptForm />
      </div>
    </div>
  )
}
