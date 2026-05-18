'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { currentTenant } from '@/lib/tenant'
import { _createPrePopulatedListing, _sendClaimEmail } from '@/actions/claim'
import { scrapeWebsiteBasics } from '@/lib/scrape-website'
import { scrapeLinkedInCompany } from '@/lib/linkedin-company-scrape'
import { generateBusinessTags } from '@/lib/ai/generate-business-tags'

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

export async function approveCsvImport(id: string): Promise<{ error: string | null; created?: number; skipped?: number; rowErrors?: string[]; emailErrors?: string[] }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }

  const svc = adminDb()
  const { data: row } = await svc
    .from('csv_imports')
    .select('id, status, source, row_count, payload')
    .eq('id', id)
    .maybeSingle() as { data: { id: string; status: string; source: string; row_count: number; payload: { rows: CsvRow[] } } | null }
  if (!row) return { error: 'Import not found' }
  if (row.status !== 'pending') return { error: `Cannot approve from status '${row.status}'` }

  // Mark approved first so the UI reflects the decision immediately.
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

  // Processing is now driven by the UI in batches via processCsvBatch.
  // We mark approved and return — the progress bar component takes over.
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
  linkedin_url?: string
  city?: string
  country?: string
}

export async function markCsvImportProcessed(id: string): Promise<{
  error: string | null
  created?: number
  skipped?: number
  rowErrors?: string[]
  emailErrors?: string[]
}> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }

  // Verify critical env vars before touching anything
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY is not set — cannot create listings' }
  }

  const svc = adminDb()
  const { data: row, error: fetchErr } = await svc
    .from('csv_imports')
    .select('id, status, row_count, payload')
    .eq('id', id)
    .maybeSingle() as { data: { id: string; status: string; row_count: number; payload: { rows: CsvRow[] } } | null; error: { message: string } | null }

  if (fetchErr) return { error: `DB read failed: ${fetchErr.message}` }
  if (!row) return { error: 'Import not found' }
  if (row.status !== 'approved') return { error: `Cannot process — current status is '${row.status}' (must be 'approved')` }

  const rows = row.payload?.rows ?? []
  if (rows.length === 0) {
    return { error: 'No rows found in import payload — the CSV data may not have saved correctly' }
  }

  let created = 0
  let skipped = 0
  const rowErrors: string[] = []
  const emailErrors: string[] = []

  for (const r of rows) {
    // Skip if this email already has a listing
    const { data: existing } = await svc
      .from('businesses')
      .select('id')
      .ilike('email', r.email)
      .limit(1) as { data: Array<{ id: string }> | null }
    if (existing && existing.length > 0) { skipped++; continue }

    // Skip if same website already has a listing
    if (r.business_url?.trim()) {
      const { data: existingWebsite } = await svc
        .from('businesses').select('id').ilike('website', r.business_url.trim()).limit(1) as { data: Array<{ id: string }> | null }
      if (existingWebsite && existingWebsite.length > 0) { skipped++; continue }
    }

    // Step 1: Scrape website for name, description, logo, cover
    const webScraped = r.business_url?.trim()
      ? await scrapeWebsiteBasics(r.business_url.trim())
      : null

    // Step 2: Scrape LinkedIn company page for founded year,
    // employee count, industry, specialties
    const linkedIn = r.linkedin_url?.trim()
      ? await scrapeLinkedInCompany(r.linkedin_url.trim())
      : null

    // Step 3: AI determines company name + generates all listing data.
    // The AI now owns name resolution — it cross-references the domain,
    // scraped site name, and page description to find the real company
    // name rather than blindly accepting a generic page title like "Home".
    const scrapedName = webScraped?.name
    const rawDesc = linkedIn?.description || webScraped?.description || null
    const aiData = await generateBusinessTags({
      websiteUrl: r.business_url?.trim() || null,
      scrapedName: scrapedName || null,
      rawDescription: rawDesc,
      industry: linkedIn?.industry || null,
      specialties: linkedIn?.specialties ?? [],
      contactName: r.full_name,
    })

    // Name priority: CSV business_name (explicit) > AI-determined > LinkedIn > full_name fallback
    const businessName = r.business_name?.trim() ||
      aiData?.name ||
      linkedIn?.name ||
      r.full_name

    const createRes = await _createPrePopulatedListing(svc, {
      name: businessName,
      email: r.email,
      full_name: r.full_name,
      tagline: aiData?.tagline || webScraped?.tagline || '',
      description: aiData?.description || rawDesc || '',
      website: r.business_url?.trim() || '',
      logo_url: linkedIn?.logo_url || webScraped?.logo_url || '',
      cover_url: linkedIn?.cover_url || webScraped?.cover_url || '',
      phone: webScraped?.phone || '',
      founded_year: linkedIn?.founded_year ?? webScraped?.founded_year ?? null,
      team_size: linkedIn?.employee_count || '',
      tags: aiData?.tags ?? [],
      city: r.city || '',
      country: r.country || '',
    })
    if (createRes.error || !createRes.business_id) {
      const msg = `${r.email}: ${createRes.error ?? 'unknown error'}`
      console.error('[csv-processor] create failed:', msg)
      rowErrors.push(msg)
      skipped++
      continue
    }
    created++

    const sendRes = await _sendClaimEmail(svc, createRes.business_id, r.full_name)
    if (sendRes.error) {
      const msg = `${r.email}: ${sendRes.error}`
      console.error('[csv-processor] email failed:', msg)
      emailErrors.push(msg)
    }
  }

  // Save the processing result back into the import record so the
  // admin UI can show it via the (i) icon without needing a separate query.
  await svc
    .from('csv_imports')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      payload: {
        rows: rows,
        result: { created, skipped, rowErrors, emailErrors },
      },
    })
    .eq('id', id)

  await logEvent(svc, 'csv_import_processed', ctx.user!.id, id, {
    row_count: row.row_count,
    created,
    skipped,
    row_errors: rowErrors,
    email_errors: emailErrors,
  })

  revalidatePath('/admin/imports')
  revalidatePath('/marketplace')
  return { error: null, created, skipped, rowErrors, emailErrors }
}

// ── Batch processing (for large imports with progress bar) ────
//
// processCsvBatch processes a slice of rows [offset, offset+batchSize)
// and updates processed_count in the DB after each batch. The UI calls
// this repeatedly — starting at offset=0, then offset=batchSize, etc. —
// until done=true is returned.
//
// Progress survives browser refresh: on remount the UI reads processed_count
// from the import row and resumes from that offset automatically.

export async function processCsvBatch(
  id: string,
  offset: number,
  batchSize: number
): Promise<{
  error: string | null
  done: boolean
  batchCreated: number
  batchSkipped: number
  batchRowErrors: string[]
  batchEmailErrors: string[]
  processedSoFar: number
  totalRows: number
}> {
  const EMPTY = { error: null, done: false, batchCreated: 0, batchSkipped: 0, batchRowErrors: [], batchEmailErrors: [], processedSoFar: offset, totalRows: 0 }
  const ctx = await requireAdmin()
  if (ctx.error) return { ...EMPTY, error: ctx.error }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ...EMPTY, error: 'SUPABASE_SERVICE_ROLE_KEY not set' }

  const svc = adminDb()
  const { data: imp } = await svc
    .from('csv_imports')
    .select('id, status, row_count, payload')
    .eq('id', id)
    .maybeSingle() as { data: { id: string; status: string; row_count: number; payload: { rows: CsvRow[]; result?: { created: number; skipped: number; rowErrors: string[]; emailErrors: string[] } } } | null }

  if (!imp) return { ...EMPTY, error: 'Import not found' }
  if (imp.status !== 'approved') return { ...EMPTY, error: `Import status is '${imp.status}' — must be 'approved'` }

  const allRows = imp.payload?.rows ?? []
  const totalRows = allRows.length
  const batch = allRows.slice(offset, offset + batchSize)

  let batchCreated = 0
  let batchSkipped = 0
  const batchRowErrors: string[] = []
  const batchEmailErrors: string[] = []

  for (const r of batch) {
    const { data: existing } = await svc
      .from('businesses').select('id').ilike('email', r.email).limit(1) as { data: Array<{ id: string }> | null }
    if (existing && existing.length > 0) { batchSkipped++; continue }

    // Also skip if a listing with the same website already exists
    if (r.business_url?.trim()) {
      const { data: existingWebsite } = await svc
        .from('businesses').select('id').ilike('website', r.business_url.trim()).limit(1) as { data: Array<{ id: string }> | null }
      if (existingWebsite && existingWebsite.length > 0) {
        batchRowErrors.push(`${r.email}: website ${r.business_url} already has a listing`)
        batchSkipped++
        continue
      }
    }

    const webScraped = r.business_url?.trim() ? await scrapeWebsiteBasics(r.business_url.trim()) : null
    const linkedIn = r.linkedin_url?.trim() ? await scrapeLinkedInCompany(r.linkedin_url.trim()) : null
    const rawDesc = linkedIn?.description || webScraped?.description || null
    const aiData = await generateBusinessTags({
      websiteUrl: r.business_url?.trim() || null,
      scrapedName: webScraped?.name || null,
      rawDescription: rawDesc,
      industry: linkedIn?.industry || null,
      specialties: linkedIn?.specialties ?? [],
      contactName: r.full_name,
    })

    const businessName = r.business_name?.trim() || aiData?.name || linkedIn?.name || r.full_name

    const createRes = await _createPrePopulatedListing(svc, {
      name: businessName, email: r.email, full_name: r.full_name,
      tagline: aiData?.tagline || webScraped?.tagline || '',
      description: aiData?.description || rawDesc || '',
      website: r.business_url?.trim() || '',
      logo_url: linkedIn?.logo_url || webScraped?.logo_url || '',
      cover_url: linkedIn?.cover_url || webScraped?.cover_url || '',
      phone: webScraped?.phone || '',
      founded_year: linkedIn?.founded_year ?? webScraped?.founded_year ?? null,
      team_size: linkedIn?.employee_count || '',
      tags: aiData?.tags ?? [],
      city: r.city || '', country: r.country || '',
    })

    if (createRes.error || !createRes.business_id) {
      const msg = `${r.email}: ${createRes.error ?? 'unknown error'}`
      console.error('[csv-batch] listing create failed:', msg)
      batchRowErrors.push(msg)
      batchSkipped++
      continue
    }
    batchCreated++

    const sendRes = await _sendClaimEmail(svc, createRes.business_id, r.full_name)
    if (sendRes.error) {
      console.error('[csv-batch] email failed:', r.email, sendRes.error)
      batchEmailErrors.push(`${r.email}: ${sendRes.error}`)
    }
  }

  // Accumulate result across batches in payload.result
  const prev = imp.payload?.result ?? { created: 0, skipped: 0, rowErrors: [], emailErrors: [] }
  const accumulated = {
    created: prev.created + batchCreated,
    skipped: prev.skipped + batchSkipped,
    rowErrors: [...prev.rowErrors, ...batchRowErrors],
    emailErrors: [...prev.emailErrors, ...batchEmailErrors],
  }

  const processedSoFar = Math.min(offset + batchSize, totalRows)
  const done = processedSoFar >= totalRows

  await svc.from('csv_imports').update({
    processed_count: processedSoFar,
    ...(done ? {
      status: 'processed',
      processed_at: new Date().toISOString(),
    } : {}),
    payload: { rows: allRows, result: accumulated },
  }).eq('id', id)

  if (done) {
    await logEvent(svc, 'csv_import_processed', ctx.user!.id, id, {
      row_count: totalRows,
      created: accumulated.created,
      skipped: accumulated.skipped,
    })
    revalidatePath('/admin/imports')
    revalidatePath('/marketplace')
  }

  return {
    error: null, done,
    batchCreated, batchSkipped, batchRowErrors, batchEmailErrors,
    processedSoFar, totalRows,
  }
}

// ── Per-import claim status ───────────────────────────────────
//
// Given an import's email list (from payload.rows), look up how many
// of those businesses have been claimed so far.

export async function getImportClaimStatus(emails: string[]): Promise<{
  error: string | null
  claimed: number
  pending: number
  details: Array<{ email: string; claimed: boolean; claimed_by: string | null; claimed_at: string | null }>
}> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error, claimed: 0, pending: 0, details: [] }
  if (!emails.length) return { error: null, claimed: 0, pending: 0, details: [] }

  const svc = adminDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = svc as any

  const { data: businesses } = await db
    .from('businesses')
    .select('email, claimed_at, owner_id, profiles!owner_id(full_name)')
    .in('email', emails.map(e => e.toLowerCase()))
    .eq('is_pre_populated', true) as {
    data: Array<{
      email: string
      claimed_at: string | null
      owner_id: string | null
      profiles?: { full_name?: string | null } | null
    }> | null
  }

  const bizMap = new Map((businesses ?? []).map(b => [b.email?.toLowerCase(), b]))
  const details = emails.map(email => {
    const biz = bizMap.get(email.toLowerCase())
    return {
      email,
      claimed: !!biz?.claimed_at,
      claimed_by: biz?.profiles?.full_name ?? null,
      claimed_at: biz?.claimed_at ?? null,
    }
  })

  return {
    error: null,
    claimed: details.filter(d => d.claimed).length,
    pending: details.filter(d => !d.claimed).length,
    details,
  }
}
