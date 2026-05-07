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
  if (profile?.role !== 'super_admin') return { error: 'Super admin only' as const, user }
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

// ── Schedule a new spotlight ──────────────────────────────────

const ScheduleSchema = z.object({
  business_id: z.string().uuid(),
  // 'YYYY-MM' from a <input type="month">. Stored as a date pinned to
  // the 1st of the month so spotlight_schedule.month is uniformly the
  // first day of the slot it represents.
  month_yyyy_mm: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM'),
  type: z.enum(['paid', 'rotated']),
})

export async function scheduleSpotlight(input: unknown): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return { error: ctx.error }

  const parsed = ScheduleSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()

  // Verify the business exists before creating the schedule row —
  // the FK would catch this anyway but the message is cleaner.
  const { data: biz } = await svc
    .from('businesses')
    .select('id, name')
    .eq('id', parsed.data.business_id)
    .maybeSingle() as { data: { id: string; name: string } | null }
  if (!biz) return { error: 'Business not found' }

  // App admin scheduling = pre-approved. CM nominations land 'pending'
  // (when the CM panel ships). Set is_spotlight=true on the business
  // immediately so the homepage spotlight slot reflects the schedule.
  const monthDate = `${parsed.data.month_yyyy_mm}-01`
  const { data: row, error } = await svc
    .from('spotlight_schedule')
    .insert({
      business_id: parsed.data.business_id,
      month: monthDate,
      type: parsed.data.type,
      status: 'approved',
      approved_by: ctx.user!.id,
      tenant_id: currentTenant(),
    })
    .select('id')
    .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }

  if (error) return { error: error.message }

  await logEvent(svc, 'spotlight_scheduled', ctx.user!.id, row?.id ?? null, {
    business_id: parsed.data.business_id,
    business_name: biz.name,
    month: monthDate,
    type: parsed.data.type,
  })

  revalidatePath('/admin/spotlight')
  return { error: null }
}

// ── Approve / reject Chapter Manager nominations ──────────────

export async function approveSpotlight(scheduleId: string): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()
  const { data: row } = await svc
    .from('spotlight_schedule')
    .select('id, status, business_id, month')
    .eq('id', scheduleId)
    .maybeSingle() as { data: { id: string; status: string; business_id: string; month: string } | null }
  if (!row) return { error: 'Spotlight not found' }
  if (row.status !== 'pending') return { error: `Cannot approve from status '${row.status}'` }

  const { error } = await svc
    .from('spotlight_schedule')
    .update({
      status: 'approved',
      approved_by: ctx.user!.id,
      rejection_reason: null,
    })
    .eq('id', scheduleId)
  if (error) return { error: error.message }

  await logEvent(svc, 'spotlight_approved', ctx.user!.id, scheduleId, {
    business_id: row.business_id,
    month: row.month,
  })

  revalidatePath('/admin/spotlight')
  return { error: null }
}

export async function rejectSpotlight(
  scheduleId: string,
  note: string
): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return { error: ctx.error }

  const parsed = z.object({ note: z.string().trim().min(3).max(500) }).safeParse({ note })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()
  const { data: row } = await svc
    .from('spotlight_schedule')
    .select('id, status, business_id, month')
    .eq('id', scheduleId)
    .maybeSingle() as { data: { id: string; status: string; business_id: string; month: string } | null }
  if (!row) return { error: 'Spotlight not found' }
  if (row.status !== 'pending') return { error: `Cannot reject from status '${row.status}'` }

  const { error } = await svc
    .from('spotlight_schedule')
    .update({
      status: 'rejected',
      rejection_reason: parsed.data.note,
      approved_by: ctx.user!.id,
    })
    .eq('id', scheduleId)
  if (error) return { error: error.message }

  await logEvent(svc, 'spotlight_rejected', ctx.user!.id, scheduleId, {
    business_id: row.business_id,
    month: row.month,
    reason: parsed.data.note,
  })

  revalidatePath('/admin/spotlight')
  return { error: null }
}

export async function cancelSpotlight(scheduleId: string): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()
  const { data: row } = await svc
    .from('spotlight_schedule')
    .select('id, status, business_id, month')
    .eq('id', scheduleId)
    .maybeSingle() as { data: { id: string; status: string; business_id: string; month: string } | null }
  if (!row) return { error: 'Spotlight not found' }
  if (row.status === 'cancelled') return { error: 'Already cancelled' }

  const { error } = await svc
    .from('spotlight_schedule')
    .update({ status: 'cancelled' })
    .eq('id', scheduleId)
  if (error) return { error: error.message }

  await logEvent(svc, 'spotlight_cancelled', ctx.user!.id, scheduleId, {
    business_id: row.business_id,
    month: row.month,
  })

  revalidatePath('/admin/spotlight')
  return { error: null }
}

// ── Business search for the schedule picker ───────────────────

export interface SpotlightBusinessResult {
  id: string
  name: string
  city: string | null
  country: string | null
}

export async function searchBusinessesForSpotlight(query: string): Promise<{
  error: string | null
  results: SpotlightBusinessResult[]
}> {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return { error: ctx.error, results: [] }

  const q = query.trim()
  if (q.length < 2) return { error: null, results: [] }
  if (/[,()*]/.test(q)) return { error: null, results: [] }

  const safe = q.replace(/[%_\\]/g, m => '\\' + m)
  const svc = adminDb()
  const { data, error } = await svc
    .from('businesses')
    .select('id, name, city, country')
    .ilike('name', `%${safe}%`)
    .eq('status', 'published')
    .limit(20) as { data: SpotlightBusinessResult[] | null; error: { message: string } | null }
  if (error) return { error: error.message, results: [] }
  return { error: null, results: data ?? [] }
}
