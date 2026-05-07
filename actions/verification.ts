'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { sendEmail, verificationSubmittedEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'
import { currentTenant } from '@/lib/tenant'

/**
 * Member-side verification submission.
 *
 * Per scope doc F01: members submit a screenshot of their EO/YPO member
 * profile page (primary signal). Optionally provide a LinkedIn URL — a
 * separate scrape worker fills in `linkedin_signal` later, displayed to
 * the admin in the queue. Neither auto-approves; the admin always
 * reviews.
 *
 * Lifecycle:
 *   - First submit: insert row with status='pending'
 *   - If a 'pending' row already exists: reject (don't double-queue)
 *   - If a 'rejected' or 'resubmit' row exists: insert a NEW row.
 *     Keeping the rejected row as history is intentional — the admin
 *     queue can show the trail. Status filter on the queue defaults to
 *     'pending' so old rows don't clutter.
 *
 * The screenshot is uploaded client-side to the existing 'eoconnect-media'
 * bucket (same pattern as business profile media). The action only
 * receives the public URL.
 */

const SubmitSchema = z.object({
  // Public URL produced by the client-side upload step. Refuse if it
  // doesn't point at our Supabase project — prevents a malicious form
  // from passing an arbitrary URL into the queue.
  screenshot_url: z.string().url(),
  // LinkedIn URL is optional but if provided must be a linkedin.com URL.
  linkedin_url: z
    .string()
    .url()
    .refine(u => /(^|\.)linkedin\.com$/i.test(new URL(u).hostname), 'Must be a linkedin.com URL')
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export async function submitVerification(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const parsed = SubmitSchema.safeParse({
    screenshot_url: formData.get('screenshot_url'),
    linkedin_url: formData.get('linkedin_url') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Confirm the URL points at this project's Supabase storage. Anything
  // else (arbitrary CDN, attacker URL) is refused.
  const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host
  if (new URL(parsed.data.screenshot_url).host !== supabaseHost) {
    return { error: 'Screenshot URL must be from project storage' }
  }

  // Look up tenant + identity from profile. Identity is needed for the
  // confirmation email; tenant is needed for the verifications row.
  const { data: profile } = await db
    .from('profiles')
    .select('tenant_id, verification_tag, full_name, eo_membership_email')
    .eq('id', user.id)
    .maybeSingle() as { data: { tenant_id: string; verification_tag: string; full_name: string | null; eo_membership_email: string | null } | null }

  if (profile?.verification_tag && profile.verification_tag !== 'unverified') {
    // Already verified. Don't accept another submission.
    return { error: 'Your membership is already verified' }
  }

  // Refuse if a pending submission already exists. A rejected/resubmit
  // row is fine — they're re-trying with new info.
  const { data: openRow } = await db
    .from('verifications')
    .select('id')
    .eq('member_id', user.id)
    .eq('status', 'pending')
    .maybeSingle() as { data: { id: string } | null }

  if (openRow) {
    return { error: 'You already have a verification awaiting review' }
  }

  const { error } = await db.from('verifications').insert({
    member_id: user.id,
    tenant_id: profile?.tenant_id ?? currentTenant(),
    method: 'screenshot',
    screenshot_url: parsed.data.screenshot_url,
    linkedin_url: parsed.data.linkedin_url ?? null,
    // linkedin_signal stays null until the scrape worker (or an admin
    // override) fills it in.
    status: 'pending',
  })

  if (error) return { error: error.message }

  // Best-effort confirmation email — log on failure but don't roll back
  // the submission. The member can always check status in-app.
  const to = profile?.eo_membership_email ?? user.email ?? null
  if (to) {
    const tpl = verificationSubmittedEmail(profile?.full_name ?? 'there', siteUrl())
    sendEmail({ to, subject: tpl.subject, html: tpl.html }).catch(err => {
      console.error('verification submitted email failed:', err)
    })
  }

  revalidatePath('/dashboard/verify')
  revalidatePath('/admin/verifications')
  return { error: null }
}
