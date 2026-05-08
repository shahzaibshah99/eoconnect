import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Page rendered when a member's profile.status = 'suspended'. The
 * route is reached either:
 *   - manually (a banned member tried to log in and got bounced here)
 *   - via the verification rejection auto-suspend (notification link
 *     points here directly)
 *
 * Surfaces profiles.suspension_reason if present so the member knows
 * what to fix. We allow this page even without auth — sometimes the
 * member's session is gone (suspended via supabase admin) but the
 * link in their email still leads here.
 */
export default async function SuspendedPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let reason: string | null = null
  if (user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data } = await db
      .from('profiles')
      .select('suspension_reason')
      .eq('id', user.id)
      .maybeSingle() as { data: { suspension_reason: string | null } | null }
    reason = data?.suspension_reason ?? null
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-card border border-border rounded-xl p-8 text-center space-y-4">
        <div className="text-5xl">🔒</div>
        <h1 className="text-2xl font-bold">Account Suspended</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Your Member Market account has been suspended.
        </p>

        {reason && (
          <div className="text-left bg-muted/40 border border-border rounded-md p-4 mt-4">
            <p className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-1">
              Reason
            </p>
            <p className="text-sm">{reason}</p>
          </div>
        )}

        <p className="text-xs text-muted-foreground pt-2">
          {reason
            ? 'Address the reason above and contact support to restore access.'
            : 'Please contact your chapter admin for more information.'}
        </p>

        <Link
          href="/login"
          className={cn(buttonVariants(), 'mt-2 bg-primary text-primary-foreground font-bold')}
        >
          Back to Login
        </Link>
      </div>
    </div>
  )
}
