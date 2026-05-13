'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { sendEmail, claimReminderEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'
import { currentTenant } from '@/lib/tenant'

function adminDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Generate a cryptographically random claim token. 32 bytes →
 * 64 hex chars. Length picked so guessability is negligible even
 * with thousands of pre-populated listings live.
 */
function generateClaimToken(): string {
  return randomBytes(32).toString('hex')
}

// ── Create a pre-populated listing ─────────────────────────────
//
// Used by the CSV import processor when admin approves a roster, AND
// available as a one-off action when admin wants to seed a single
// listing. owner_id is null until claimed; claim_token is required.

const CreatePrePopSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().toLowerCase(),
  full_name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  website: z.string().trim().url().optional().or(z.literal('')),
  city: z.string().trim().max(60).optional().or(z.literal('')),
  country: z.string().trim().max(60).optional().or(z.literal('')),
})

export type CreatePrePopInput = z.input<typeof CreatePrePopSchema>

/**
 * Internal helper used by the CSV import processor. Not exported as a
 * server action because it doesn't auth-check — caller is already
 * inside an admin context.
 *
 * Returns the claim_token so the caller can build the magic link.
 */
export async function _createPrePopulatedListing(
  svc: ReturnType<typeof adminDb>,
  input: CreatePrePopInput
): Promise<{ error: string | null; business_id?: string; claim_token?: string }> {
  const parsed = CreatePrePopSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const claim_token = generateClaimToken()
  // 60-day claim window per scope. Token expires at the same time;
  // the listing stays live (per spec) but no further claims accepted.
  const expires_at = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await svc
    .from('businesses')
    .insert({
      // owner_id intentionally null — set at claim time.
      name: parsed.data.name,
      email: parsed.data.email,
      description: parsed.data.description || null,
      website: parsed.data.website || null,
      city: parsed.data.city || null,
      country: parsed.data.country || null,
      status: 'published',
      verification_tag: 'unverified',
      tenant_id: currentTenant(),
      is_pre_populated: true,
      claim_token,
      claim_token_expires_at: expires_at,
      claim_email_sent_at: null,
      claim_email_count: 0,
    })
    .select('id')
    .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }

  if (error) return { error: error.message }
  if (!data) return { error: 'Insert returned no row' }

  return { error: null, business_id: data.id, claim_token }
}

/**
 * Send the initial claim email to the business owner. Updates
 * claim_email_sent_at + increments claim_email_count so the daily
 * cron knows when to send follow-ups.
 *
 * Best-effort email — caller decides what to do on failure.
 */
export async function _sendClaimEmail(
  svc: ReturnType<typeof adminDb>,
  businessId: string
): Promise<{ error: string | null }> {
  const { data: biz } = await svc
    .from('businesses')
    .select('id, name, email, claim_token, claim_email_count')
    .eq('id', businessId)
    .maybeSingle() as { data: { id: string; name: string; email: string | null; claim_token: string | null; claim_email_count: number } | null }
  if (!biz) return { error: 'Business not found' }
  if (!biz.email) return { error: 'Business has no email on file' }
  if (!biz.claim_token) return { error: 'Business has no claim token' }

  const claimUrl = `${siteUrl()}/claim/${biz.claim_token}`
  const tpl = claimReminderEmail('there', biz.name, 60, claimUrl)
  const result = await sendEmail({ to: biz.email, subject: tpl.subject, html: tpl.html })
  if (!result.ok) return { error: result.error ?? 'Email send failed' }

  await svc
    .from('businesses')
    .update({
      claim_email_sent_at: new Date().toISOString(),
      claim_email_count: (biz.claim_email_count ?? 0) + 1,
    })
    .eq('id', businessId)

  return { error: null }
}

// ── Claim flow (member-side) ───────────────────────────────────

const ClaimTokenSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Invalid claim token format')

export interface ClaimPreview {
  business_id: string
  name: string
  email: string | null
  description: string | null
  city: string | null
  country: string | null
  website: string | null
  is_expired: boolean
  is_already_claimed: boolean
}

/**
 * Look up a claim token to render the /claim/[token] landing page.
 * Returns enough info to show the user what they're about to claim
 * before they confirm. Does NOT mutate anything.
 *
 * Public — the token IS the auth. Caller doesn't need to be signed in.
 */
export async function previewClaim(token: string): Promise<{ error: string | null; preview?: ClaimPreview }> {
  const parsed = ClaimTokenSchema.safeParse(token)
  if (!parsed.success) return { error: 'Invalid claim link' }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Server not configured to handle claims' }
  }
  const svc = adminDb()
  const { data: biz } = await svc
    .from('businesses')
    .select('id, name, email, description, city, country, website, claim_token_expires_at, claimed_at')
    .eq('claim_token', token)
    .maybeSingle() as { data: {
      id: string; name: string; email: string | null; description: string | null;
      city: string | null; country: string | null; website: string | null;
      claim_token_expires_at: string | null; claimed_at: string | null;
    } | null }

  if (!biz) return { error: 'Claim link not found — it may have already been used or revoked' }

  const expired = biz.claim_token_expires_at
    ? new Date(biz.claim_token_expires_at) < new Date()
    : false

  return {
    error: null,
    preview: {
      business_id: biz.id,
      name: biz.name,
      email: biz.email,
      description: biz.description,
      city: biz.city,
      country: biz.country,
      website: biz.website,
      is_expired: expired,
      is_already_claimed: !!biz.claimed_at,
    },
  }
}

/**
 * Complete a claim. Caller must be authenticated — the action links
 * the listing to their auth.user via owner_id. The caller's email
 * doesn't have to match the business email; matching is the admin's
 * problem upstream (CSV processor uses their email to seed the listing,
 * the claim assumes the right person clicked the right link).
 *
 * Sets:
 *   businesses.owner_id = auth.uid()
 *   businesses.claimed_at = now()
 *   businesses.is_pre_populated = false  (it's no longer awaiting claim)
 *   businesses.claim_token = null         (one-shot — link is dead now)
 */
export async function completeClaim(token: string): Promise<{ error: string | null; business_id?: string }> {
  const parsed = ClaimTokenSchema.safeParse(token)
  if (!parsed.success) return { error: 'Invalid claim link' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please sign in or sign up first to claim this listing' }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Server not configured to handle claims' }
  }
  const svc = adminDb()

  // Re-fetch the row inside the action so we can validate state
  // server-side. Don't trust the preview snapshot.
  const { data: biz } = await svc
    .from('businesses')
    .select('id, name, claim_token_expires_at, claimed_at, owner_id')
    .eq('claim_token', token)
    .maybeSingle() as { data: { id: string; name: string; claim_token_expires_at: string | null; claimed_at: string | null; owner_id: string | null } | null }
  if (!biz) return { error: 'Claim link not found — it may have already been used or revoked' }
  if (biz.claimed_at) return { error: 'This listing has already been claimed' }
  if (biz.owner_id) return { error: 'This listing already has an owner' }
  if (biz.claim_token_expires_at && new Date(biz.claim_token_expires_at) < new Date()) {
    return { error: 'This claim link has expired. Contact your chapter manager for a fresh link.' }
  }

  const { error } = await svc
    .from('businesses')
    .update({
      owner_id: user.id,
      claimed_at: new Date().toISOString(),
      is_pre_populated: false,
      claim_token: null,
      claim_token_expires_at: null,
    })
    .eq('id', biz.id)
    // Concurrency guard: refuse the update if owner_id has been set by
    // another race — UPDATE..WHERE will affect 0 rows in that case.
    .is('owner_id', null)
    .select('id')
    .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }

  if (error) return { error: error.message }

  // Auto-verify the claimer as 'eo_member'.
  //
  // Per CEO + marketing decision: members who receive a claim email
  // are sourced from a trusted EO member list (Dripify / CSV import).
  // The fact they received and acted on the invite is sufficient proof
  // of membership — requiring a screenshot upload on top is redundant
  // friction. Organic sign-ups (not via claim link) still go through
  // the normal verification queue.
  //
  // Also stamps onboarded_at so the proxy never bounces claimed users
  // back to /onboarding or /get-started.
  await svc
    .from('profiles')
    .update({
      verification_tag: 'eo_member',
      onboarded_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  // Audit. Best-effort but loud — same pattern as actions/admin.ts.
  const { error: logErr } = await svc.from('events_log').insert({
    type: 'business_claimed',
    member_id: user.id,
    entity_id: biz.id,
    metadata: { business_name: biz.name },
    tenant_id: currentTenant(),
  })
  if (logErr) {
    console.error('[audit] business_claimed log failed:', logErr.message)
  }

  revalidatePath('/dashboard')
  revalidatePath(`/marketplace/${biz.id}`)
  return { error: null, business_id: biz.id }
}
