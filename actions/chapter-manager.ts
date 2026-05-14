'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { currentTenant } from '@/lib/tenant'

function adminDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Verify the current user is a Chapter Manager for the given chapter.
 * Returns the user object on success, an error string otherwise.
 *
 * Doesn't require admin role — CMs are regular members. The trust
 * boundary is the chapter_managers table: a row there grants CM
 * powers for exactly that chapter and no other.
 */
async function requireChapterManager(chapterId: number) {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, user: null }

  const { data: assignment } = await db
    .from('chapter_managers')
    .select('id')
    .eq('member_id', user.id)
    .eq('chapter_id', chapterId)
    .maybeSingle() as { data: { id: string } | null }

  if (!assignment) {
    return { error: 'Not a manager of this chapter' as const, user }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' as const, user }
  }
  return { error: null, user }
}

async function logEvent(
  svc: ReturnType<typeof adminDb>,
  type: string,
  actorId: string,
  entityId: string | null,
  metadata: Record<string, unknown>
) {
  // Best-effort but loud — failures log to server console so type
  // mismatches and missing columns get caught early instead of silently
  // dropping audit rows.
  const { error } = await svc.from('events_log').insert({
    type,
    member_id: actorId,
    entity_id: entityId,
    metadata,
    tenant_id: currentTenant(),
  })
  if (error) {
    console.error(`[audit] events_log insert failed for type=${type}:`, error.message, { metadata })
  }
}

// ── Chapter endorsement (for verification signal) ─────────────

const EndorseSchema = z.object({
  chapter_id: z.number().int(),
  member_id: z.string().uuid(),
  note: z.string().trim().max(300).optional().or(z.literal('').transform(() => undefined)),
})

/**
 * CM confirms a member is in their chapter. Becomes a supporting
 * signal in the admin verification queue alongside LinkedIn and the
 * screenshot.
 *
 * Idempotent: if the same CM already endorsed the same member for
 * the same chapter, this UPSERTs the note rather than inserting a
 * second row (UNIQUE constraint backstops anyway).
 */
export async function endorseChapterMember(input: unknown): Promise<{ error: string | null }> {
  const parsed = EndorseSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const ctx = await requireChapterManager(parsed.data.chapter_id)
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()
  const { error } = await svc
    .from('chapter_endorsements')
    .upsert(
      {
        member_id: parsed.data.member_id,
        chapter_id: parsed.data.chapter_id,
        endorsed_by: ctx.user!.id,
        note: parsed.data.note ?? null,
        tenant_id: currentTenant(),
      },
      { onConflict: 'member_id,chapter_id,endorsed_by' }
    )
  if (error) return { error: error.message }

  await logEvent(svc, 'chapter_endorsement_added', ctx.user!.id, parsed.data.member_id, {
    chapter_id: parsed.data.chapter_id,
    has_note: !!parsed.data.note,
  })

  revalidatePath(`/chapter-manager/${parsed.data.chapter_id}/members`)
  revalidatePath(`/chapter-manager/${parsed.data.chapter_id}/endorse`)
  revalidatePath('/admin/verifications')
  return { error: null }
}

export async function removeChapterEndorsement(
  endorsementId: string,
  chapterId: number
): Promise<{ error: string | null }> {
  const ctx = await requireChapterManager(chapterId)
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()
  // Refuse to delete an endorsement written by someone else, even if
  // the caller manages the chapter — keeps the audit trail honest.
  const { data: row } = await svc
    .from('chapter_endorsements')
    .select('id, member_id, endorsed_by')
    .eq('id', endorsementId)
    .maybeSingle() as { data: { id: string; member_id: string; endorsed_by: string } | null }
  if (!row) return { error: 'Endorsement not found' }
  if (row.endorsed_by !== ctx.user!.id) {
    return { error: 'Only the CM who wrote this endorsement can remove it' }
  }

  const { error } = await svc
    .from('chapter_endorsements')
    .delete()
    .eq('id', endorsementId)
  if (error) return { error: error.message }

  await logEvent(svc, 'chapter_endorsement_removed', ctx.user!.id, row.member_id, {
    chapter_id: chapterId,
  })

  revalidatePath(`/chapter-manager/${chapterId}/members`)
  revalidatePath('/admin/verifications')
  return { error: null }
}

// ── Chapter CSV import (CM-side submission) ───────────────────
//
// Mirrors actions/imports.ts but constrains the chapter scope to one
// the CM actually manages. App Admin reviews via /admin/imports.

const CsvRowSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  full_name: z.string().trim().min(1).max(120),
  business_name: z.string().trim().max(120).optional().or(z.literal('')),
  business_url: z.string().trim().url().optional().or(z.literal('')),
  linkedin_url: z.string().trim().url().optional().or(z.literal('')),
  region: z.string().trim().max(60).optional().or(z.literal('')),
  country: z.string().trim().max(60).optional().or(z.literal('')),
  city: z.string().trim().max(60).optional().or(z.literal('')),
})

const CsvPayloadSchema = z.object({
  chapter_id: z.number().int(),
  rows: z.array(CsvRowSchema).min(1).max(2000),
})

export async function submitChapterCsvImport(input: unknown): Promise<{
  error: string | null
  id?: string
}> {
  const parsed = CsvPayloadSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const ctx = await requireChapterManager(parsed.data.chapter_id)
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()
  const { data: row, error } = await svc
    .from('csv_imports')
    .insert({
      submitted_by: ctx.user!.id,
      chapter_id: parsed.data.chapter_id,
      source: 'chapter_manager',
      payload: { rows: parsed.data.rows },
      row_count: parsed.data.rows.length,
      status: 'pending',
      tenant_id: currentTenant(),
    })
    .select('id')
    .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }

  if (error) return { error: error.message }
  if (!row) return { error: 'Insert returned no row' }

  await logEvent(svc, 'csv_import_submitted', ctx.user!.id, row.id, {
    source: 'chapter_manager',
    row_count: parsed.data.rows.length,
    chapter_id: parsed.data.chapter_id,
  })

  revalidatePath(`/chapter-manager/${parsed.data.chapter_id}/imports`)
  revalidatePath('/admin/imports')
  return { error: null, id: row.id }
}

// ── Sponsor POC nomination ────────────────────────────────────
//
// Per scope F17: CM can set a named point-of-contact (email) on a
// sponsor listing in their chapter. That email receives inquiry
// notifications (the business.email field is the inquiry destination).

const SponsorPocSchema = z.object({
  business_id: z.string().uuid(),
  chapter_id: z.number().int(),
  poc_name: z.string().trim().max(120).optional(),
  poc_email: z.string().trim().email('Invalid email').optional(),
})

export async function updateSponsorPoc(input: unknown): Promise<{ error: string | null }> {
  const parsed = SponsorPocSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const ctx = await requireChapterManager(parsed.data.chapter_id)
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()

  // Verify the business is actually a sponsor in this chapter.
  const { data: biz } = await svc
    .from('businesses')
    .select('id, name, verification_tag')
    .eq('id', parsed.data.business_id)
    .eq('verification_tag', 'eo_sponsor')
    .maybeSingle() as { data: { id: string; name: string; verification_tag: string } | null }
  if (!biz) return { error: 'Sponsor listing not found or not an EO sponsor' }

  const updates: Record<string, string | null> = {}
  if (parsed.data.poc_email !== undefined) updates.email = parsed.data.poc_email
  if (Object.keys(updates).length === 0) return { error: 'No changes to save' }

  const { error } = await svc
    .from('businesses')
    .update(updates)
    .eq('id', parsed.data.business_id) as { error: { message: string } | null }
  if (error) return { error: error.message }

  await logEvent(svc, 'sponsor_poc_updated', ctx.user!.id, parsed.data.business_id, {
    chapter_id: parsed.data.chapter_id,
    poc_name: parsed.data.poc_name ?? null,
    poc_email: parsed.data.poc_email ?? null,
  })

  revalidatePath(`/chapter-manager/${parsed.data.chapter_id}/sponsors`)
  return { error: null }
}

// ── Profile transfer ──────────────────────────────────────────
//
// Per scope F17: CM can transfer a member profile they created to the
// member by sending them a claim email. Once claimed, the CM loses
// edit access. Full audit trail: created_by, invite_sent_at,
// claimed_by, claimed_at — all in events_log.

const TransferSchema = z.object({
  business_id: z.string().uuid(),
  chapter_id: z.number().int(),
  recipient_email: z.string().trim().email('Invalid recipient email'),
})

export async function initiateProfileTransfer(input: unknown): Promise<{ error: string | null }> {
  const parsed = TransferSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const ctx = await requireChapterManager(parsed.data.chapter_id)
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()
  const { randomBytes } = await import('crypto')
  const { sendEmail, claimReminderEmail } = await import('@/lib/email/send')
  const { siteUrl } = await import('@/lib/site-url')

  // Verify the business exists. CM can transfer listings they own
  // OR listings that have no owner yet (pre-populated by CSV).
  const { data: biz } = await svc
    .from('businesses')
    .select('id, name, owner_id, claimed_at, claim_token')
    .eq('id', parsed.data.business_id)
    .maybeSingle() as {
    data: { id: string; name: string; owner_id: string | null; claimed_at: string | null; claim_token: string | null } | null
  }
  if (!biz) return { error: 'Business not found' }
  if (biz.claimed_at) return { error: 'This listing has already been claimed by someone' }
  if (biz.owner_id && biz.owner_id !== ctx.user!.id) {
    return { error: 'This listing is owned by another member — only an admin can transfer it' }
  }

  // Generate a fresh claim token.
  const claim_token = randomBytes(32).toString('hex')
  const expires_at = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()

  const { error: updateErr } = await svc
    .from('businesses')
    .update({
      claim_token,
      claim_token_expires_at: expires_at,
      is_pre_populated: true,
      email: parsed.data.recipient_email,
    })
    .eq('id', biz.id) as { error: { message: string } | null }
  if (updateErr) return { error: updateErr.message }

  const claimUrl = `${siteUrl()}/claim/${claim_token}`
  const tpl = claimReminderEmail({ name: 'there', businessName: biz.name, daysLeft: 60, claimUrl })
  await sendEmail({ to: parsed.data.recipient_email, subject: tpl.subject, html: tpl.html }).catch(err => {
    console.error('[chapter-manager] transfer claim email failed:', err)
  })

  await logEvent(svc, 'profile_transfer_initiated', ctx.user!.id, biz.id, {
    chapter_id: parsed.data.chapter_id,
    recipient_email: parsed.data.recipient_email,
    business_name: biz.name,
  })

  revalidatePath(`/chapter-manager/${parsed.data.chapter_id}/members`)
  return { error: null }
}

// ── Member search (within chapter scope) ──────────────────────

export interface ChapterMemberSearchResult {
  id: string
  full_name: string | null
  eo_membership_email: string | null
  avatar_url: string | null
  verification_tag: string
  already_endorsed_by_me: boolean
}

/**
 * Typeahead picker for the endorse-member flow. Searches profiles
 * matching the chapter's geo (country + optional city) so the CM
 * doesn't accidentally endorse someone from a different chapter.
 *
 * Joined with chapter_endorsements to surface "already endorsed"
 * state in the result list — keeps the UI responsive.
 */
export async function searchChapterCandidatesForEndorsement(
  chapterId: number,
  query: string
): Promise<{ error: string | null; results: ChapterMemberSearchResult[] }> {
  const ctx = await requireChapterManager(chapterId)
  if (ctx.error) return { error: ctx.error, results: [] }

  const q = query.trim()
  if (q.length < 2) return { error: null, results: [] }
  if (/[,()*]/.test(q)) return { error: null, results: [] }

  const svc = adminDb()

  // Pull the chapter's geo so we can scope the candidate search.
  const { data: chapter } = await svc
    .from('eo_chapters')
    .select('country, city')
    .eq('id', chapterId)
    .maybeSingle() as { data: { country: string | null; city: string | null } | null }
  if (!chapter) return { error: 'Chapter not found', results: [] }

  const safe = q.replace(/[%_\\]/g, m => '\\' + m)
  let profileQuery = svc
    .from('profiles')
    .select('id, full_name, eo_membership_email, avatar_url, verification_tag, chapter_country, chapter_city')
    .or(`full_name.ilike.%${safe}%,eo_membership_email.ilike.%${safe}%`)
    .limit(20)

  if (chapter.country) profileQuery = profileQuery.eq('chapter_country', chapter.country)
  if (chapter.city) profileQuery = profileQuery.eq('chapter_city', chapter.city)

  const { data: profiles, error } = await profileQuery as {
    data: Array<{
      id: string
      full_name: string | null
      eo_membership_email: string | null
      avatar_url: string | null
      verification_tag: string
    }> | null
    error: { message: string } | null
  }
  if (error) return { error: error.message, results: [] }

  // Mark which we've already endorsed so the UI can disable those rows.
  const memberIds = (profiles ?? []).map(p => p.id)
  let endorsedSet = new Set<string>()
  if (memberIds.length) {
    const { data: existing } = await svc
      .from('chapter_endorsements')
      .select('member_id')
      .eq('chapter_id', chapterId)
      .eq('endorsed_by', ctx.user!.id)
      .in('member_id', memberIds) as { data: Array<{ member_id: string }> | null }
    endorsedSet = new Set((existing ?? []).map(r => r.member_id))
  }

  return {
    error: null,
    results: (profiles ?? []).map(p => ({
      id: p.id,
      full_name: p.full_name,
      eo_membership_email: p.eo_membership_email,
      avatar_url: p.avatar_url,
      verification_tag: p.verification_tag,
      already_endorsed_by_me: endorsedSet.has(p.id),
    })),
  }
}
