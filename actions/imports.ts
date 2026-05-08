'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { currentTenant } from '@/lib/tenant'
import { _createPrePopulatedListing, _sendClaimEmail } from '@/actions/claim'

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
  if (!user) return { error: 'Not authenticated' as const, user: null, role: null }
  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null }
  if (!profile || !['chapter_admin', 'super_admin'].includes(profile.role)) {
    return { error: 'Not authorized' as const, user, role: null }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' as const, user, role: profile.role }
  }
  return { error: null, user, role: profile.role }
}

async function logEvent(
  svc: ReturnType<typeof adminDb>,
  type: string,
  adminId: string,
  entityId: string | null,
  metadata: Record<string, unknown>
) {
  // Best-effort but loud — failures log to server console so type
  // mismatches and missing columns get caught early instead of silently
  // dropping audit rows.
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

// ── Schema for parsed CSV rows ────────────────────────────────
//
// Minimal shape for v1: email + name are required, everything else is
// optional metadata captured for the future claim flow. Stricter
// validation can come later — the priority here is capturing usable
// data without rejecting reasonable input.

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

export type CsvImportRow = z.infer<typeof CsvRowSchema>

const PayloadSchema = z.object({
  rows: z.array(CsvRowSchema).min(1, 'No valid rows in CSV').max(2000, 'Imports are capped at 2000 rows'),
  chapter_id: z.number().int().nullable().optional(),
})

// ── Submit a fresh import (App Admin direct) ─────────────────────

export async function submitCsvImportAsAdmin(input: {
  rows: unknown[]
  chapter_id: number | null
}): Promise<{ error: string | null; id?: string }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }

  const parsed = PayloadSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()
  // App Admin uploads land status='pending' too — they can self-approve
  // to process. Keeps the audit trail clean even for direct uploads.
  const { data: row, error } = await svc
    .from('csv_imports')
    .insert({
      submitted_by: ctx.user!.id,
      chapter_id: parsed.data.chapter_id ?? null,
      source: 'admin',
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
    source: 'admin',
    row_count: parsed.data.rows.length,
    chapter_id: parsed.data.chapter_id ?? null,
  })

  revalidatePath('/admin/imports')
  return { error: null, id: row.id }
}

// ── Approve / reject / mark processed ────────────────────────────

const NoteSchema = z.object({
  note: z.string().trim().min(3).max(500),
})

export async function approveCsvImport(id: string): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()
  const { data: row } = await svc
    .from('csv_imports')
    .select('id, status, source, row_count')
    .eq('id', id)
    .maybeSingle() as { data: { id: string; status: string; source: string; row_count: number } | null }
  if (!row) return { error: 'Import not found' }
  if (row.status !== 'pending') return { error: `Cannot approve from status '${row.status}'` }

  const { error } = await svc
    .from('csv_imports')
    .update({
      status: 'approved',
      reviewed_by: ctx.user!.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', id)
  if (error) return { error: error.message }

  await logEvent(svc, 'csv_import_approved', ctx.user!.id, id, {
    source: row.source,
    row_count: row.row_count,
  })

  revalidatePath('/admin/imports')
  return { error: null }
}

export async function rejectCsvImport(id: string, note: string): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }

  const parsed = NoteSchema.safeParse({ note })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()
  const { data: row } = await svc
    .from('csv_imports')
    .select('id, status, source, row_count')
    .eq('id', id)
    .maybeSingle() as { data: { id: string; status: string; source: string; row_count: number } | null }
  if (!row) return { error: 'Import not found' }
  if (row.status !== 'pending') return { error: `Cannot reject from status '${row.status}'` }

  const { error } = await svc
    .from('csv_imports')
    .update({
      status: 'rejected',
      rejection_reason: parsed.data.note,
      reviewed_by: ctx.user!.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: error.message }

  await logEvent(svc, 'csv_import_rejected', ctx.user!.id, id, {
    source: row.source,
    row_count: row.row_count,
    reason: parsed.data.note,
  })

  revalidatePath('/admin/imports')
  return { error: null }
}

/**
 * Process an approved CSV import: iterate the payload rows, create one
 * pre-populated business listing per row, and fire claim invites.
 *
 * Per scope F03:
 *   - Listings created with is_pre_populated=true, owner_id=null,
 *     claim_token set, claim_token_expires_at = now + 60d
 *   - Each gets an immediate "claim your profile" email
 *   - The daily slow-replier/claim cron sends day-1/7/30 reminders
 *
 * Skipped rows (duplicate email already on file as a published listing,
 * malformed data, etc.) are reported in the result summary. The import
 * row's status becomes 'processed' even if some rows skip — the
 * processed_at timestamp marks end-of-run, not full success.
 */
interface CsvRow {
  email: string
  full_name: string
  business_name?: string
  business_url?: string
  city?: string
  country?: string
}

export async function markCsvImportProcessed(id: string): Promise<{ error: string | null; created?: number; skipped?: number }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()
  const { data: row } = await svc
    .from('csv_imports')
    .select('id, status, row_count, payload')
    .eq('id', id)
    .maybeSingle() as { data: { id: string; status: string; row_count: number; payload: { rows: CsvRow[] } } | null }
  if (!row) return { error: 'Import not found' }
  if (row.status !== 'approved') return { error: 'Only approved imports can be marked processed' }

  const rows = row.payload?.rows ?? []
  let created = 0
  let skipped = 0

  for (const r of rows) {
    // Skip rows where this email is already on file as a claimed
    // (real-owner) listing. Multiple pre-populated rows on the same
    // email are also skipped — first one wins, the rest are noise.
    const { data: existing } = await svc
      .from('businesses')
      .select('id')
      .ilike('email', r.email)
      .limit(1) as { data: Array<{ id: string }> | null }
    if (existing && existing.length > 0) {
      skipped++
      continue
    }

    const createRes = await _createPrePopulatedListing(svc, {
      name: r.business_name?.trim() || r.full_name,
      email: r.email,
      full_name: r.full_name,
      website: r.business_url || '',
      city: r.city || '',
      country: r.country || '',
      description: '',
    })
    if (createRes.error || !createRes.business_id) {
      console.error('[csv-processor] create failed for', r.email, createRes.error)
      skipped++
      continue
    }
    created++

    // Fire the initial claim email. Best-effort — one bad address can't
    // halt the whole batch.
    const sendRes = await _sendClaimEmail(svc, createRes.business_id)
    if (sendRes.error) {
      console.error('[csv-processor] claim email failed for', r.email, sendRes.error)
    }
  }

  const { error } = await svc
    .from('csv_imports')
    .update({ status: 'processed', processed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }

  await logEvent(svc, 'csv_import_processed', ctx.user!.id, id, {
    row_count: row.row_count,
    created,
    skipped,
  })

  revalidatePath('/admin/imports')
  revalidatePath('/marketplace')
  return { error: null, created, skipped }
}
