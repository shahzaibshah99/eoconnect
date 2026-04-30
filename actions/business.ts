'use server'

import { createClient } from '@/lib/supabase/server'
import { uploadFile } from '@/lib/storage'
import { refreshBusinessEmbedding } from '@/lib/ai/refresh-business-embedding'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { PORTFOLIO_MAX_TOTAL_BYTES, formatBytes } from '@/lib/portfolio-limits'
import { normalizeWebsite } from '@/lib/normalize-website'

// Two distinct duplicate-website errors so the UI can guide the user
// to the right next step:
//   - SAME owner: edit the existing listing instead of duplicating.
//   - DIFFERENT owner: another member already claimed this URL; if
//     they believe the existing claim is wrong, they need to talk to
//     the EO team rather than retry. Andrew + Shahzaib + team
//     escalated this from "moderation queue" to "hard block" so as
//     not to ship an admin-review queue at launch.
const DUPLICATE_WEBSITE_MESSAGE_OWN =
  'You already have a business with this website. Edit the existing one or use a different URL.'
const DUPLICATE_WEBSITE_MESSAGE_OTHER =
  'Another member has already listed this website. If you believe this is in error, please reach out to the EO team.'

/**
 * Sums HEAD-fetched Content-Length for a list of public Supabase Storage URLs.
 * Used to enforce the portfolio total-size cap server-side: client validation
 * could be bypassed, but files were already uploaded direct-to-storage by the
 * time the action runs, so we re-check via the public URL metadata.
 *
 * Returns null if any URL fails to report size (we then refuse the write
 * rather than silently letting through unknown bytes).
 */
async function totalBytesFromUrls(urls: string[]): Promise<number | null> {
  if (urls.length === 0) return 0
  let total = 0
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (!res.ok) return null
      const len = res.headers.get('content-length')
      if (!len) return null
      total += Number(len)
    } catch {
      return null
    }
  }
  return total
}

const BusinessSchema = z.object({
  name: z.string().min(2, 'Business name required'),
  tagline: z.string().optional(),
  description: z.string().optional(),
  // Accept plain domains like "remap.ai" — auto-prepend https:// if missing.
  // Empty string passes through; a non-empty value must be a valid URL after normalization.
  website: z.preprocess((val) => {
    if (typeof val !== 'string') return val
    const trimmed = val.trim()
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `https://${trimmed}`
  }, z.string().url().optional().or(z.literal(''))),
  founded_year: z.preprocess(
    v => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(1900).max(new Date().getFullYear()).optional()
  ),
  team_size: z.enum(['1-10', '11-50', '51-200', '201-500', '500+']).optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  country_code: z.string().length(2).optional().or(z.literal('')),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  category_ids: z.array(z.string()).max(3).optional(),
  tags: z.array(z.string()).max(10).optional(),
})

export type BusinessActionResult = { error: string | null; id?: string }

export async function createBusiness(formData: FormData): Promise<BusinessActionResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const raw = {
    name: formData.get('name'),
    tagline: formData.get('tagline'),
    description: formData.get('description'),
    website: formData.get('website'),
    founded_year: formData.get('founded_year'),
    team_size: formData.get('team_size'),
    city: formData.get('city'),
    country: formData.get('country'),
    country_code: formData.get('country_code') || '',
    phone: formData.get('phone'),
    email: formData.get('email'),
    category_ids: formData.getAll('category_ids'),
    tags: (formData.get('tags') as string | null)?.split(',').map(t => t.trim()).filter(Boolean) ?? [],
  }

  const parsed = BusinessSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Global duplicate-website block. First member to list a URL wins;
  // anyone else gets a friendly error pointing them at the EO team.
  // Migration 018's partial unique index is the real backstop against
  // races; this pre-check exists to surface the *right* error message
  // (own-listing vs other-member) instead of the raw 23505.
  const normalizedWebsite = normalizeWebsite(parsed.data.website)
  if (normalizedWebsite) {
    const { data: existingDup } = await db
      .from('businesses')
      .select('id, owner_id')
      .eq('website_normalized', normalizedWebsite)
      .limit(1) as { data: Array<{ id: string; owner_id: string }> | null }
    if (existingDup && existingDup.length > 0) {
      const isOwnListing = existingDup[0].owner_id === user.id
      return {
        error: isOwnListing
          ? DUPLICATE_WEBSITE_MESSAGE_OWN
          : DUPLICATE_WEBSITE_MESSAGE_OTHER,
      }
    }
  }

  // Files now come in as URLs (uploaded directly to Supabase Storage from
  // the client) — keeps the action body small enough for Vercel's ~4.5MB cap.
  // Legacy File-object fallback still supported for older clients.
  let logo_url: string | undefined = (formData.get('logo_url') as string | null) ?? undefined
  let cover_url: string | undefined = (formData.get('cover_url') as string | null) ?? undefined

  try {
    const logoFile = formData.get('logo') as File | null
    const coverFile = formData.get('cover') as File | null

    if (!logo_url && logoFile && logoFile.size > 0) {
      logo_url = await uploadFile('eoconnect-media', `logos/${user.id}-${Date.now()}`, logoFile)
    }
    if (!cover_url && coverFile && coverFile.size > 0) {
      cover_url = await uploadFile('eoconnect-media', `covers/${user.id}-${Date.now()}`, coverFile)
    }

    // Portfolio: prefer URL strings (direct upload). Fall back to File objects.
    const portfolioUrls = formData.getAll('portfolio_url') as string[]
    const portfolio_urls: string[] = portfolioUrls.slice(0, 5)
    if (portfolio_urls.length === 0) {
      const portfolioFiles = formData.getAll('portfolio') as File[]
      for (const file of portfolioFiles.slice(0, 5)) {
        if (file.size > 0) {
          const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]/g, '_').slice(0, 80) || 'document.pdf'
          const url = await uploadFile('eoconnect-media', `portfolio/${user.id}/${Date.now()}-${safeName}`, file)
          portfolio_urls.push(url)
        }
      }
    }

    // Server-side enforcement of the 25MB total cap.
    const totalBytes = await totalBytesFromUrls(portfolio_urls)
    if (totalBytes === null) {
      return { error: 'Could not verify portfolio file sizes' }
    }
    if (totalBytes > PORTFOLIO_MAX_TOTAL_BYTES) {
      return { error: `Portfolio total ${formatBytes(totalBytes)} exceeds the ${formatBytes(PORTFOLIO_MAX_TOTAL_BYTES)} limit` }
    }

    const social_links: Record<string, string> = {}
    for (const platform of ['linkedin', 'twitter', 'instagram', 'facebook']) {
      const val = formData.get(`social_${platform}`) as string | null
      if (val) social_links[platform] = val
    }

    // Handle custom categories: insert or find each, then merge IDs
    const customCatsRaw = formData.get('custom_categories') as string | null
    const customCatNames = customCatsRaw?.split(',').map(s => s.trim()).filter(Boolean) ?? []
    const extraCategoryIds: string[] = []
    for (const name of customCatNames) {
      const { data: found } = await db.from('categories').select('id').ilike('name', name).single()
      if (found?.id) {
        extraCategoryIds.push(found.id)
      } else {
        const { data: created } = await db.from('categories').insert({ name, active: true }).select('id').single()
        if (created?.id) extraCategoryIds.push(created.id)
      }
    }
    const mergedCategoryIds = [...(parsed.data.category_ids ?? []), ...extraCategoryIds].slice(0, 3)

    const { data, error } = await db
      .from('businesses')
      .insert({
        owner_id: user.id,
        ...parsed.data,
        category_ids: mergedCategoryIds,
        logo_url,
        cover_url,
        portfolio_urls,
        social_links,
        status: 'published',
      })
      .select('id')
      .single() as { data: { id: string } | null; error: { code?: string; message: string } | null }

    if (error) {
      // 23505 = Postgres unique_violation. Catch the race that beat
      // the pre-check (two concurrent inserts with the same website).
      // We don't know from the error alone whether the existing row
      // belongs to the same user or a different one, so we re-check
      // here to surface the right friendly message.
      if (error.code === '23505' && normalizedWebsite) {
        const { data: claimant } = await db
          .from('businesses')
          .select('owner_id')
          .eq('website_normalized', normalizedWebsite)
          .limit(1) as { data: Array<{ owner_id: string }> | null }
        const isOwnListing = !!claimant && claimant.length > 0 && claimant[0].owner_id === user.id
        return {
          error: isOwnListing
            ? DUPLICATE_WEBSITE_MESSAGE_OWN
            : DUPLICATE_WEBSITE_MESSAGE_OTHER,
        }
      }
      return { error: error.message }
    }

    // Mark new-user onboarding fully complete (only if not already set).
    // Existing users were grandfathered in migration 005, so this is a no-op for them.
    await db.from('profiles')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('onboarded_at', null)

    // Compute search embedding (fire-and-forget — don't block redirect)
    if (data?.id) {
      void refreshBusinessEmbedding(db, data.id)
    }

    revalidatePath('/marketplace')
    redirect('/dashboard/services')
  } catch (err) {
    if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err
    return { error: err instanceof Error ? err.message : 'Failed to create business' }
  }
}

export async function updateBusiness(id: string, formData: FormData): Promise<BusinessActionResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: existing } = await db
    .from('businesses')
    .select('id, owner_id')
    .eq('id', id)
    .single() as { data: { id: string; owner_id: string } | null }

  if (!existing) return { error: 'Business not found' }

  if (existing.owner_id !== user.id) {
    // Allow admins to edit any business
    const { data: me } = await db.from('profiles').select('role').eq('id', user.id).single() as {
      data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null
    }
    if (!me || !['chapter_admin', 'super_admin'].includes(me.role)) {
      return { error: 'Not authorized' }
    }
  }

  const raw = {
    name: formData.get('name'),
    tagline: formData.get('tagline'),
    description: formData.get('description'),
    website: formData.get('website'),
    founded_year: formData.get('founded_year'),
    team_size: formData.get('team_size'),
    city: formData.get('city'),
    country: formData.get('country'),
    country_code: formData.get('country_code') || '',
    phone: formData.get('phone'),
    email: formData.get('email'),
    category_ids: formData.getAll('category_ids'),
    tags: (formData.get('tags') as string | null)?.split(',').map(t => t.trim()).filter(Boolean) ?? [],
  }

  const parsed = BusinessSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Same global duplicate-website guard as createBusiness, but excluding
  // the row being updated (otherwise saving without changing the URL
  // would always fail).
  const normalizedWebsite = normalizeWebsite(parsed.data.website)
  if (normalizedWebsite) {
    const { data: clash } = await db
      .from('businesses')
      .select('id, owner_id')
      .eq('website_normalized', normalizedWebsite)
      .neq('id', id)
      .limit(1) as { data: Array<{ id: string; owner_id: string }> | null }
    if (clash && clash.length > 0) {
      const isOwnListing = clash[0].owner_id === existing.owner_id
      return {
        error: isOwnListing
          ? DUPLICATE_WEBSITE_MESSAGE_OWN
          : DUPLICATE_WEBSITE_MESSAGE_OTHER,
      }
    }
  }

  // URL strings preferred (direct client upload). File-object fallback kept
  // for backward compat with stale clients.
  let logo_url: string | undefined = (formData.get('logo_url') as string | null) ?? undefined
  let cover_url: string | undefined = (formData.get('cover_url') as string | null) ?? undefined

  try {
    const logoFile = formData.get('logo') as File | null
    const coverFile = formData.get('cover') as File | null

    if (!logo_url && logoFile && logoFile.size > 0) {
      logo_url = await uploadFile('eoconnect-media', `logos/${user.id}-${Date.now()}`, logoFile)
    }
    if (!cover_url && coverFile && coverFile.size > 0) {
      cover_url = await uploadFile('eoconnect-media', `covers/${user.id}-${Date.now()}`, coverFile)
    }

    const portfolioKeep = formData.getAll('portfolio_keep') as string[]
    const newPortfolioUrls: string[] = formData.getAll('portfolio_url') as string[]
    if (newPortfolioUrls.length === 0) {
      const portfolioNewFiles = formData.getAll('portfolio') as File[]
      for (const file of portfolioNewFiles.slice(0, 5)) {
        if (file.size > 0) {
          const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]/g, '_').slice(0, 80) || 'document.pdf'
          const url = await uploadFile('eoconnect-media', `portfolio/${user.id}/${Date.now()}-${safeName}`, file)
          newPortfolioUrls.push(url)
        }
      }
    }
    const portfolio_urls = [...portfolioKeep, ...newPortfolioUrls].slice(0, 5)

    // Server-side enforcement of the 25MB total cap (kept + newly uploaded).
    const totalBytes = await totalBytesFromUrls(portfolio_urls)
    if (totalBytes === null) {
      return { error: 'Could not verify portfolio file sizes' }
    }
    if (totalBytes > PORTFOLIO_MAX_TOTAL_BYTES) {
      return { error: `Portfolio total ${formatBytes(totalBytes)} exceeds the ${formatBytes(PORTFOLIO_MAX_TOTAL_BYTES)} limit` }
    }

    const social_links: Record<string, string> = {}
    for (const platform of ['linkedin', 'twitter', 'instagram', 'facebook']) {
      const val = formData.get(`social_${platform}`) as string | null
      if (val) social_links[platform] = val
    }

    const updateData: Record<string, unknown> = { ...parsed.data, social_links, portfolio_urls }
    if (logo_url) updateData.logo_url = logo_url
    if (cover_url) updateData.cover_url = cover_url

    // Belt-and-braces: scope the UPDATE to the same owner_id we just
    // authorized. RLS already enforces this, but if RLS were ever
    // accidentally relaxed (or this code ran with a service-role client),
    // we'd still only mutate the row we checked. Note: existing.owner_id is
    // used (not user.id) so admin overrides above still work — admins keep
    // editing as the listing's actual owner.
    const { error } = await db
      .from('businesses')
      .update(updateData)
      .eq('id', id)
      .eq('owner_id', existing.owner_id) as { error: { code?: string; message: string } | null }
    if (error) {
      // Same race-loser handling as createBusiness — re-look-up the
      // colliding owner so we can return the right friendly message.
      if (error.code === '23505' && normalizedWebsite) {
        const { data: claimant } = await db
          .from('businesses')
          .select('owner_id')
          .eq('website_normalized', normalizedWebsite)
          .neq('id', id)
          .limit(1) as { data: Array<{ owner_id: string }> | null }
        const isOwnListing =
          !!claimant && claimant.length > 0 && claimant[0].owner_id === existing.owner_id
        return {
          error: isOwnListing
            ? DUPLICATE_WEBSITE_MESSAGE_OWN
            : DUPLICATE_WEBSITE_MESSAGE_OTHER,
        }
      }
      return { error: error.message }
    }

    // Refresh search embedding (fire-and-forget)
    void refreshBusinessEmbedding(db, id)

    revalidatePath('/marketplace')
    revalidatePath(`/marketplace/${id}`)
    revalidatePath('/dashboard/business/edit')
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update business' }
  }
}

/**
 * Permanently delete a business owned by the caller.
 *
 * On delete, schema-level ON DELETE CASCADE rules clean up:
 *   - services
 *   - listing_analytics
 *   - reviews
 *   - ad_campaigns
 * `conversations.listing_id` is set null so past message threads survive.
 *
 * Caller must pass the business's exact name as `confirmName` to guard
 * against accidental deletes — the dashboard form requires the user to
 * type it before submit.
 */
export async function deleteBusiness(
  id: string,
  confirmName: string
): Promise<BusinessActionResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Load the row first to verify ownership AND match the typed name.
  const { data: biz } = await db
    .from('businesses')
    .select('id, name, owner_id')
    .eq('id', id)
    .maybeSingle() as { data: { id: string; name: string; owner_id: string } | null }

  if (!biz) return { error: 'Business not found' }
  if (biz.owner_id !== user.id) return { error: 'Not authorized to delete this business' }
  if (biz.name.trim().toLowerCase() !== confirmName.trim().toLowerCase()) {
    return { error: `Type the business name exactly to confirm: "${biz.name}"` }
  }

  const { error } = await db.from('businesses').delete().eq('id', id).eq('owner_id', user.id)
  if (error) return { error: error.message }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/services')
  revalidatePath('/dashboard/business/edit')
  revalidatePath('/marketplace')
  return { error: null }
}

/**
 * Member-side status change. Owner-only: pause their own listing or
 * resume one they themselves paused.
 *
 * Critically does NOT let an owner override an admin pause. If an admin
 * paused the listing as a moderation action, only an admin can resume
 * it — otherwise members could undo every moderation pause by clicking
 * "Resume" on their dashboard.
 *
 * `paused_by` provenance is set/cleared here in lockstep with `status`:
 *   - status='paused' → paused_by='owner'
 *   - status='published' or 'draft' → paused_by=null
 */
export async function updateBusinessStatus(
  id: string,
  status: 'draft' | 'published' | 'paused'
): Promise<BusinessActionResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Read current state to enforce the admin-pause-precedence rule.
  // Scoped to owner_id so a member can't even see status of someone
  // else's listing through this code path (RLS enforces this too).
  const { data: existing } = await db
    .from('businesses')
    .select('status, paused_by, owner_id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle() as {
      data: { status: 'draft' | 'published' | 'paused'; paused_by: 'owner' | 'admin' | null; owner_id: string } | null
    }
  if (!existing) return { error: 'Business not found or not owned by you' }

  // The one rule that matters: if an admin paused this listing, the
  // owner can't get out of paused state. They have to contact the
  // admin or wait for the moderation hold to lift.
  if (existing.status === 'paused' && existing.paused_by === 'admin' && status !== 'paused') {
    return { error: 'This listing was paused by an administrator and can only be resumed by an administrator.' }
  }

  const updateData: { status: typeof status; paused_by: 'owner' | 'admin' | null } = {
    status,
    paused_by: status === 'paused' ? 'owner' : null,
  }

  const { error } = await db
    .from('businesses')
    .update(updateData)
    .eq('id', id)
    .eq('owner_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/services')
  revalidatePath('/dashboard/business/edit')
  revalidatePath('/marketplace')
  revalidatePath(`/marketplace/${id}`)
  return { error: null }
}
