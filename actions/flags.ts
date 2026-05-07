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

async function requireAdmin() {
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
  if (!profile || !['chapter_admin', 'super_admin'].includes(profile.role)) {
    return { error: 'Not authorized' as const, user }
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
  try {
    await svc.from('events_log').insert({
      type,
      member_id: adminId,
      entity_id: entityId,
      metadata,
      tenant_id: currentTenant(),
    })
  } catch {
    // swallow
  }
}

// ── Member-side: submit a flag ────────────────────────────────

const FlagSchema = z.object({
  target_type: z.enum(['listing', 'post', 'response', 'review', 'message']),
  target_id: z.string().uuid(),
  type: z.enum(['solicitation', 'spam', 'inaccurate', 'inappropriate']),
  reason: z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined)),
})

/**
 * Member-side: file a flag against a listing/post/response/review/message.
 * Open to any authenticated member. The admin queue picks it up and the
 * resolution UI handles dispositions.
 *
 * No de-duplication on (reporter, target) — a member could legitimately
 * flag the same target for two different types (e.g. spam + inappropriate).
 * The queue groups by target so duplicates across reporters are visible
 * and contribute to the 3-flag escalation count.
 */
export async function submitFlag(input: unknown): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const parsed = FlagSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { error } = await db.from('flags').insert({
    target_type: parsed.data.target_type,
    target_id: parsed.data.target_id,
    reporter_id: user.id,
    type: parsed.data.type,
    reason: parsed.data.reason ?? null,
    tenant_id: currentTenant(),
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/flags')
  return { error: null }
}

// ── Admin-side: resolve flags ─────────────────────────────────

const ResolveSchema = z.object({
  note: z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined)),
})

/**
 * Resolve all open flags against a single target with one disposition.
 * Per scope F06: 3+ flags auto-escalate and the admin acts on the
 * target as a whole, not on individual flag rows. Each open flag is
 * marked with the chosen disposition so the audit trail is preserved.
 */
async function resolveFlagsForTarget(
  svc: ReturnType<typeof adminDb>,
  adminId: string,
  targetType: string,
  targetId: string,
  disposition: 'dismissed' | 'warned' | 'suspended' | 'banned',
  note: string | null
): Promise<{ error: string | null; affected: number }> {
  const { data: rows, error } = await svc
    .from('flags')
    .update({
      status: disposition,
      resolved_by: adminId,
      resolved_at: new Date().toISOString(),
      resolution_note: note,
    })
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('status', 'open')
    .select('id') as { data: Array<{ id: string }> | null; error: { message: string } | null }

  if (error) return { error: error.message, affected: 0 }
  return { error: null, affected: rows?.length ?? 0 }
}

export async function dismissFlagsForTarget(
  targetType: string,
  targetId: string,
  note?: string
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }

  const parsed = ResolveSchema.safeParse({ note })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()
  const result = await resolveFlagsForTarget(
    svc, ctx.user!.id, targetType, targetId, 'dismissed', parsed.data.note ?? null
  )
  if (result.error) return { error: result.error }

  await logEvent(svc, 'flags_dismissed', ctx.user!.id, targetId, {
    target_type: targetType,
    affected: result.affected,
    note: parsed.data.note ?? null,
  })

  revalidatePath('/admin/flags')
  return { error: null }
}

/**
 * Disposition that ALSO acts on the offending member: warn / suspend / ban.
 *
 * - warn: just resolves the flag(s) with the warning recorded; member
 *   gets a notification (TODO once email wiring is added for warnings).
 * - suspend: sets profile.status = 'suspended' on the offending member.
 * - ban: same as suspend for now — ban is a stronger label that also
 *   prevents re-registration. Future: extend with a banned_emails table
 *   to block re-signup with the same address.
 *
 * The "offending member" is the owner of the target (listing owner /
 * post author / message sender). Resolved here by walking the polymorphic
 * target_type to its owner column.
 */
export async function disposeFlagsAgainstMember(
  targetType: 'listing' | 'post' | 'response' | 'review' | 'message',
  targetId: string,
  disposition: 'warned' | 'suspended' | 'banned',
  note?: string
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }

  const parsed = ResolveSchema.safeParse({ note })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()

  // Resolve flag rows first — even if owner lookup fails the admin
  // intent is recorded.
  const resolveRes = await resolveFlagsForTarget(
    svc, ctx.user!.id, targetType, targetId, disposition, parsed.data.note ?? null
  )
  if (resolveRes.error) return { error: resolveRes.error }

  // Walk to the offending member depending on target type.
  let offenderId: string | null = null
  if (targetType === 'listing') {
    const { data } = await svc.from('businesses').select('owner_id').eq('id', targetId).maybeSingle() as {
      data: { owner_id: string } | null
    }
    offenderId = data?.owner_id ?? null
  } else if (targetType === 'review') {
    const { data } = await svc.from('reviews').select('reviewer_id').eq('id', targetId).maybeSingle() as {
      data: { reviewer_id: string } | null
    }
    offenderId = data?.reviewer_id ?? null
  }
  // post / response / message tables don't exist yet (F04/F05 work) —
  // when they ship, add their owner-column lookups here.

  if ((disposition === 'suspended' || disposition === 'banned') && offenderId) {
    const { error } = await svc.from('profiles').update({ status: 'suspended' }).eq('id', offenderId)
    if (error) return { error: error.message }
  }

  await logEvent(svc, `flags_${disposition}`, ctx.user!.id, targetId, {
    target_type: targetType,
    offender_id: offenderId,
    affected_flags: resolveRes.affected,
    note: parsed.data.note ?? null,
  })

  revalidatePath('/admin/flags')
  revalidatePath('/admin/members')
  return { error: null }
}
