import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { currentTenant } from '@/lib/tenant'

/**
 * Per marketing-lead feedback: until verified, members cannot list
 * businesses, create posts, or send messages. This module is the
 * single place that defines what "verified" means and how to gate
 * actions on it.
 *
 * "Verified" = profiles.verification_tag != 'unverified'.
 * 'unverified' is the default; admin approval flips it to one of
 * the assignable tags (eo_member, eo_alumni, etc.) via approveVerification.
 */

export interface VerificationGateResult {
  ok: boolean
  /** Reason to surface back to the caller. Server actions return this
   *  in their error field; UIs can pre-empt by checking the gate
   *  in advance and disabling the button. */
  reason?: string
}

/**
 * Check whether a user is allowed to take member-only actions. Suspended
 * accounts are also blocked (covers the auto-suspend on verification
 * rejection — those members can't act until admin lifts the suspension).
 */
export async function requireVerified(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string
): Promise<VerificationGateResult> {
  const { data: profile } = await db
    .from('profiles')
    .select('verification_tag, status')
    .eq('id', userId)
    .maybeSingle() as { data: { verification_tag: string; status: string } | null }

  if (!profile) return { ok: false, reason: 'Profile not found' }
  if (profile.status === 'suspended') {
    return { ok: false, reason: 'Your account is suspended. Check the suspended page for details.' }
  }
  if (profile.verification_tag === 'unverified') {
    return {
      ok: false,
      reason: 'Verify your membership first. Go to /dashboard/verify to submit a screenshot of your member profile.',
    }
  }
  return { ok: true }
}

/**
 * Insert an in-app notification for a member. The bell in the navbar
 * picks it up via the (app) layout query and surfaces under the bell
 * dropdown. Best-effort — failure logs but doesn't bubble.
 *
 * Server-only because notifications are a system-side concern (admin
 * actions create them on behalf of the recipient). Uses service-role
 * client so the recipient's RLS doesn't block insertions.
 */
export async function notifyMember(input: {
  userId: string
  type: string
  title: string
  body?: string | null
  link?: string | null
}): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[notify] SUPABASE_SERVICE_ROLE_KEY not set — skipping notification')
    return
  }
  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  const { error } = await svc.from('notifications').insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    tenant_id: currentTenant(),
  })
  if (error) {
    console.error('[notify] insert failed:', error.message, { type: input.type, user: input.userId })
  }
}
