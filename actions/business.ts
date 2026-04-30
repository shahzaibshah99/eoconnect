'use server'

import { createClient } from '@/lib/supabase/server'
import { uploadFile } from '@/lib/storage'
import { refreshBusinessEmbedding } from '@/lib/ai/refresh-business-embedding'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { PORTFOLIO_MAX_TOTAL_BYTES, formatBytes } from '@/lib/portfolio-limits'

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
      .single()

    if (error) return { error: error.message }

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
      .eq('owner_id', existing.owner_id)
    if (error) return { error: error.message }

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

export async function updateBusinessStatus(
  id: string,
  status: 'draft' | 'published' | 'paused'
): Promise<BusinessActionResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await db
    .from('businesses')
    .update({ status })
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
