'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { currentTenant } from '@/lib/tenant'

// Reuse the same admin-DB helper pattern as actions/admin.ts. Defined
// locally rather than imported to keep this file's surface narrow and
// make the chapter feature easy to reason about in isolation.
function adminDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

async function requireSuperAdmin() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, user: null }

  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null }

  if (profile?.role !== 'super_admin') {
    return { error: 'Super admin only' as const, user }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' as const, user }
  }
  return { error: null, user }
}

async function logEvent(
  svc: ReturnType<typeof adminDb>,
  type: string,
  adminId: string,
  entityId: string | null,
  metadata: Record<string, unknown>
) {
  // Best-effort audit insertion — a failed log row must never block the
  // chapter mutation that triggered it, but we DO surface the error in
  // server logs. Silent-swallow hid a uuid/bigint type mismatch for chapter
  // events for several days; future regressions should be loud, not silent.
  const { error } = await svc.from('events_log').insert({
    type,
    member_id: adminId,
    entity_id: entityId,
    metadata,
    tenant_id: currentTenant(),
  })
  if (error) {
    console.error(`[audit] events_log insert failed for type=${type}:`, error.message, { metadata })
  }
}

// ── Manager assignment ─────────────────────────────────────────

export async function assignChapterManager(
  chapterId: number,
  memberId: string
): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()

  // Verify both ends exist before inserting — surfaces a friendlier
  // error than the FK violation message Supabase would return.
  const { data: chapter } = await svc
    .from('eo_chapters')
    .select('id, name')
    .eq('id', chapterId)
    .maybeSingle() as { data: { id: number; name: string } | null }
  if (!chapter) return { error: 'Chapter not found' }

  const { data: member } = await svc
    .from('profiles')
    .select('id, full_name, status')
    .eq('id', memberId)
    .maybeSingle() as { data: { id: string; full_name: string | null; status: string } | null }
  if (!member) return { error: 'Member not found in directory' }
  if (member.status === 'suspended') return { error: 'Cannot assign a suspended member' }

  const { error } = await svc
    .from('chapter_managers')
    .insert({
      chapter_id: chapterId,
      member_id: memberId,
      tenant_id: currentTenant(),
    })

  if (error) {
    // UNIQUE(chapter_id, member_id) violation = already assigned. Surface
    // a clear message instead of leaking the postgres error.
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return { error: 'This member is already a manager of this chapter' }
    }
    return { error: error.message }
  }

  // events_log.entity_id is uuid — chapter ids are bigint, so keep
  // them in metadata and pass null for entity_id. The audit page
  // surfaces chapter context from metadata anyway.
  await logEvent(svc, 'chapter_manager_assigned', ctx.user!.id, null, {
    chapter_id: chapterId,
    chapter_name: chapter.name,
    member_id: memberId,
    member_name: member.full_name,
  })

  revalidatePath('/admin/chapters')
  return { error: null }
}

export async function removeChapterManager(
  assignmentId: string
): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()

  // Capture context before delete — without it the audit row tells you
  // an assignment was removed but not which chapter or member it linked.
  const { data: row } = await svc
    .from('chapter_managers')
    .select('id, chapter_id, member_id')
    .eq('id', assignmentId)
    .maybeSingle() as { data: { id: string; chapter_id: number; member_id: string } | null }
  if (!row) return { error: 'Assignment not found' }

  const { error } = await svc
    .from('chapter_managers')
    .delete()
    .eq('id', assignmentId)
  if (error) return { error: error.message }

  await logEvent(svc, 'chapter_manager_removed', ctx.user!.id, null, {
    chapter_id: row.chapter_id,
    member_id: row.member_id,
    assignment_id: assignmentId,
  })

  revalidatePath('/admin/chapters')
  return { error: null }
}

// ── Sponsor slot allocation ────────────────────────────────────

const SlotsSchema = z.object({
  slots: z.coerce.number().int().min(0).max(50),
})

export async function setChapterSponsorSlots(
  chapterId: number,
  slots: number
): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return { error: ctx.error }

  const parsed = SlotsSchema.safeParse({ slots })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()
  const { data, error } = await svc
    .from('eo_chapters')
    .update({ sponsor_slots: parsed.data.slots })
    .eq('id', chapterId)
    .select('id, name')
    .maybeSingle() as { data: { id: number; name: string } | null; error: { message: string } | null }

  if (error) return { error: error.message }
  if (!data) return { error: 'Chapter not found' }

  await logEvent(svc, 'chapter_sponsor_slots_set', ctx.user!.id, null, {
    chapter_id: chapterId,
    chapter_name: data.name,
    slots: parsed.data.slots,
  })

  revalidatePath('/admin/chapters')
  return { error: null }
}

// ── Member search for assignment picker ────────────────────────

export interface ChapterMemberSearchResult {
  id: string
  full_name: string | null
  eo_membership_email: string | null
  avatar_url: string | null
  eo_chapter: string | null
  chapter_country: string | null
  chapter_city: string | null
}

/**
 * Typeahead picker for the assign-manager flow. Mirrors
 * searchMembersForTransfer in actions/admin.ts but lives here because
 * the chapter feature owns its own search semantics — e.g. we may want
 * to bias toward members already in the target chapter at some point.
 */
export async function searchMembersForChapter(query: string): Promise<{
  error: string | null
  results: ChapterMemberSearchResult[]
}> {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return { error: ctx.error, results: [] }

  const q = query.trim()
  if (q.length < 2) return { error: null, results: [] }
  if (/[,()*]/.test(q)) return { error: null, results: [] }

  const safe = q.replace(/[%_\\]/g, m => '\\' + m)
  const svc = adminDb()
  const { data, error } = await svc
    .from('profiles')
    .select('id, full_name, eo_membership_email, avatar_url, eo_chapter, chapter_country, chapter_city')
    .or(`full_name.ilike.%${safe}%,eo_membership_email.ilike.%${safe}%`)
    .limit(20) as { data: ChapterMemberSearchResult[] | null; error: { message: string } | null }

  if (error) return { error: error.message, results: [] }
  return { error: null, results: data ?? [] }
}
