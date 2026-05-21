'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { sendEmail, verificationSubmittedEmail, verificationPendingAdminEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'
import { currentTenant, type TenantId } from '@/lib/tenant'
import { scrapeProfileForMembership } from '@/lib/linkedin-verification-scrape'
import { notifyMember } from '@/lib/verification-gate'
import { isAssignableTag, assignableTagsForTenant, type AssignableTag } from '@/lib/verification-tags'

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
  // The tag the member is claiming (e.g. eo_member, eo_alumni). Optional
  // for backwards-compat but validated against the tenant's allowed tags
  // when provided.
  claimed_tag: z.string().optional(),
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
    claimed_tag: formData.get('claimed_tag') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Confirm the URL points at this project's Supabase storage. Anything
  // else (arbitrary CDN, attacker URL) is refused.
  const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host
  if (new URL(parsed.data.screenshot_url).host !== supabaseHost) {
    return { error: 'Screenshot URL must be from project storage' }
  }

  // Look up tenant + identity from profile. Identity is needed for the
  // confirmation email; tenant is needed for the verifications row;
  // chapter is included in the admin notification email.
  const { data: profile } = await db
    .from('profiles')
    .select('tenant_id, verification_tag, full_name, eo_membership_email, eo_chapter')
    .eq('id', user.id)
    .maybeSingle() as { data: { tenant_id: string; verification_tag: string; full_name: string | null; eo_membership_email: string | null; eo_chapter: string | null } | null }

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

  const tenantId = (profile?.tenant_id ?? currentTenant()) as TenantId

  // Validate claimed_tag belongs to the tenant's allowed set.
  let claimedTag: AssignableTag | null = null
  if (parsed.data.claimed_tag) {
    const allowed = assignableTagsForTenant(tenantId)
    if (isAssignableTag(parsed.data.claimed_tag) && allowed.includes(parsed.data.claimed_tag as AssignableTag)) {
      claimedTag = parsed.data.claimed_tag as AssignableTag
    }
  }

  const { data: inserted, error } = await db.from('verifications').insert({
    member_id: user.id,
    tenant_id: tenantId,
    method: 'screenshot',
    screenshot_url: parsed.data.screenshot_url,
    linkedin_url: parsed.data.linkedin_url ?? null,
    claimed_tag: claimedTag,
    // linkedin_signal stays null until the scrape worker (or an admin
    // override) fills it in.
    status: 'pending',
  })
    .select('id')
    .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }

  if (error) return { error: error.message }

  // Email side-effects are defensively wrapped — the verification row
  // is already saved at this point, so a missing env var (siteUrl,
  // SMTP, etc.) or template error must NOT bubble out and 500 the
  // user-facing submit. Log and continue.
  const memberName = profile?.full_name ?? 'there'
  const memberEmail = profile?.eo_membership_email ?? user.email ?? null
  try {
    if (memberEmail) {
      const tpl = verificationSubmittedEmail(memberName, siteUrl())
      sendEmail({ to: memberEmail, subject: tpl.subject, html: tpl.html }).catch(err => {
        console.error('[verification] member confirmation email failed:', err)
      })
    }
  } catch (err) {
    console.error('[verification] member confirmation email setup failed:', err)
  }

  // Fan out to all super_admins so the queue gets picked up. Service-role
  // client because the user-scoped session can't read other users' rows.
  // Per-recipient sendEmail is a Promise — swallow individual rejections
  // so one bad address doesn't take down the whole loop.
  try {
    if (inserted?.id && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const svc = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: admins } = await (svc as any)
        .from('profiles')
        .select('id, eo_membership_email, full_name')
        .eq('role', 'super_admin') as { data: Array<{ id: string; eo_membership_email: string | null; full_name: string | null }> | null }

      const adminTpl = verificationPendingAdminEmail({
        memberName,
        memberEmail,
        memberChapter: profile?.eo_chapter ?? null,
        hasLinkedIn: !!parsed.data.linkedin_url,
        siteUrl: siteUrl(),
      })
      for (const admin of admins ?? []) {
        // Email notification
        if (admin.eo_membership_email) {
          sendEmail({
            to: admin.eo_membership_email,
            subject: adminTpl.subject,
            html: adminTpl.html,
          }).catch(err => {
            console.error('[verification] admin notification email failed for', admin.eo_membership_email, err)
          })
        }
        // In-app bell notification — shows up immediately in the admin's
        // navbar bell with a link straight to the verification queue.
        if (admin.id) {
          notifyMember({
            userId: admin.id,
            type: 'verification_pending',
            title: `New verification from ${memberName}`,
            body: profile?.eo_chapter
              ? `${memberName} · ${profile.eo_chapter}`
              : memberName,
            link: '/admin/verifications',
          }).catch(err => {
            console.error('[verification] admin in-app notify failed for', admin.id, err)
          })
        }
      }
    }
  } catch (err) {
    console.error('[verification] admin notification setup failed:', err)
  }

  // Fire the LinkedIn scrape in the background — admins should see the
  // signal next time they refresh the queue, but we don't wait for it
  // here (RapidAPI calls add 2-5s latency on the submit path otherwise).
  // No-op if no LinkedIn URL was provided or RAPIDAPI_LINKEDIN_KEY is unset.
  if (inserted?.id && parsed.data.linkedin_url) {
    void runLinkedInScrapeForVerification(inserted.id, parsed.data.linkedin_url, tenantId)
  }

  revalidatePath('/dashboard/verify')
  revalidatePath('/admin/verifications')
  return { error: null }
}

/**
 * Background scrape job. Runs after submitVerification returns to the
 * client so the user isn't waiting on RapidAPI. Writes the resulting
 * signal back to the verifications row via service-role client.
 *
 * Errors are swallowed and logged — leaving linkedin_signal null is the
 * right fallback (admin sees "not checked" and can manually override).
 */
async function runLinkedInScrapeForVerification(
  verificationId: string,
  linkedinUrl: string,
  tenantId: TenantId
): Promise<void> {
  try {
    const signal = await scrapeProfileForMembership(linkedinUrl, tenantId)
    if (signal === null) return // null = error or skipped, leave column null

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return
    const svc = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    )
    await svc
      .from('verifications')
      .update({ linkedin_signal: signal })
      .eq('id', verificationId)
  } catch (err) {
    console.error('[verification] background LinkedIn scrape failed:', err)
  }
}
