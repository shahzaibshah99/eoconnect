'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { isInChapterScope } from '@/lib/chapter-scope'

// Service-role client for operations that need to bypass RLS
// (writing to other users' profile rows).
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
  if (!user) {
    return {
      error: 'Not authenticated' as const, supabase, db, user: null,
      role: null as 'member' | 'chapter_admin' | 'super_admin' | null,
      scopeCountry: null as string | null, scopeCity: null as string | null,
    }
  }

  const { data: profile } = await db
    .from('profiles')
    .select('role, admin_scope_country, admin_scope_city')
    .eq('id', user.id)
    .single() as { data: {
      role: 'member' | 'chapter_admin' | 'super_admin'
      admin_scope_country: string | null
      admin_scope_city: string | null
    } | null }

  if (!profile || !['chapter_admin', 'super_admin'].includes(profile.role)) {
    return {
      error: 'Not authorized' as const, supabase, db, user,
      role: null as 'member' | 'chapter_admin' | 'super_admin' | null,
      scopeCountry: null as string | null, scopeCity: null as string | null,
    }
  }

  return {
    error: null, supabase, db, user,
    role: profile.role,
    scopeCountry: profile.admin_scope_country,
    scopeCity: profile.admin_scope_city,
  }
}

/**
 * For chapter_admin: verify the target row is within their assigned scope.
 * super_admin bypasses (returns true). Returns false if chapter_admin has no
 * scope configured (refuse rather than allow global writes).
 *
 * Businesses inherit their chapter from the owner's profile (businesses don't
 * carry a chapter tag of their own — see migration 008).
 */
async function targetInScope(
  db: ReturnType<typeof adminDb>,
  ctx: { role: 'chapter_admin' | 'super_admin'; scopeCountry: string | null; scopeCity: string | null },
  table: 'profiles' | 'businesses',
  id: string
): Promise<boolean> {
  if (ctx.role === 'super_admin') return true
  if (!ctx.scopeCountry) return false

  if (table === 'profiles') {
    const { data } = await db
      .from('profiles')
      .select('chapter_country, chapter_city')
      .eq('id', id)
      .single() as { data: { chapter_country: string | null; chapter_city: string | null } | null }
    if (!data) return false
    return isInChapterScope(data, { country: ctx.scopeCountry, city: ctx.scopeCity })
  }

  // Businesses → look up owner profile's chapter.
  const { data: biz } = await db
    .from('businesses')
    .select('owner_id')
    .eq('id', id)
    .single() as { data: { owner_id: string } | null }
  if (!biz?.owner_id) return false

  const { data: owner } = await db
    .from('profiles')
    .select('chapter_country, chapter_city')
    .eq('id', biz.owner_id)
    .single() as { data: { chapter_country: string | null; chapter_city: string | null } | null }
  if (!owner) return false
  return isInChapterScope(owner, { country: ctx.scopeCountry, city: ctx.scopeCity })
}

async function reviewBusinessId(db: ReturnType<typeof adminDb>, reviewId: string): Promise<string | null> {
  const { data } = await db
    .from('reviews')
    .select('business_id')
    .eq('id', reviewId)
    .single() as { data: { business_id: string } | null }
  return data?.business_id ?? null
}

// ── Categories ────────────────────────────────────────────────

const CategorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens'),
  icon: z.string().trim().max(8).optional(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
})

export async function createCategory(formData: FormData): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (ctx.role !== 'super_admin') return { error: 'Super admin only' }

  const parsed = CategorySchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    icon: formData.get('icon') ?? undefined,
    sort_order: formData.get('sort_order') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { error } = await ctx.db.from('categories').insert({ ...parsed.data, active: true })
  if (error) return { error: error.message }
  revalidatePath('/admin/categories')
  revalidatePath('/marketplace')
  return { error: null }
}

export async function updateCategory(id: string, formData: FormData): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (ctx.role !== 'super_admin') return { error: 'Super admin only' }

  const parsed = CategorySchema.partial().safeParse({
    name: formData.get('name') ?? undefined,
    slug: formData.get('slug') ?? undefined,
    icon: formData.get('icon') ?? undefined,
    sort_order: formData.get('sort_order') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { error } = await ctx.db.from('categories').update(parsed.data).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/categories')
  return { error: null }
}

export async function toggleCategoryActive(id: string, active: boolean): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (ctx.role !== 'super_admin') return { error: 'Super admin only' }

  const { error } = await ctx.db.from('categories').update({ active }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/categories')
  revalidatePath('/marketplace')
  return { error: null }
}

// ── Members ───────────────────────────────────────────────────

export async function setMemberStatus(
  userId: string,
  status: 'pending' | 'active' | 'suspended'
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (!ctx.role) return { error: 'Not authorized' }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }
  }

  const svc = adminDb()
  if (!(await targetInScope(svc, ctx as { role: 'chapter_admin' | 'super_admin'; scopeCountry: string | null; scopeCity: string | null }, 'profiles', userId))) {
    return { error: 'This member is outside your chapter scope' }
  }

  const { data, error } = await svc
    .from('profiles')
    .update({ status })
    .eq('id', userId)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'No profile updated — user not found' }
  revalidatePath('/admin/members')
  return { error: null }
}

export async function setMemberRole(
  userId: string,
  role: 'member' | 'chapter_admin' | 'super_admin'
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (ctx.role !== 'super_admin') return { error: 'Super admin only' }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }
  }

  // Service-role write: profile RLS blocks super-admins from updating
  // other users' rows, and the user-scoped client silently no-ops
  // (0 rows affected, no error). Bypass RLS for this admin action.
  const { data, error } = await adminDb()
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'No profile updated — user not found' }
  revalidatePath('/admin/members')
  return { error: null }
}

// ── Review moderation ────────────────────────────────────────

export async function unflagReview(id: string): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (!ctx.role) return { error: 'Not authorized' }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }
  }

  const svc = adminDb()
  // Reviews are scoped through their business's chapter.
  if (ctx.role === 'chapter_admin') {
    const businessId = await reviewBusinessId(svc, id)
    if (!businessId) return { error: 'Review not found' }
    if (!(await targetInScope(svc, ctx as { role: 'chapter_admin'; scopeCountry: string | null; scopeCity: string | null }, 'businesses', businessId))) {
      return { error: 'This review belongs to a business outside your chapter scope' }
    }
  }

  const { error } = await svc.from('reviews').update({ flagged: false }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/reviews')
  return { error: null }
}

export async function deleteReview(id: string): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (!ctx.role) return { error: 'Not authorized' }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }
  }

  const svc = adminDb()
  if (ctx.role === 'chapter_admin') {
    const businessId = await reviewBusinessId(svc, id)
    if (!businessId) return { error: 'Review not found' }
    if (!(await targetInScope(svc, ctx as { role: 'chapter_admin'; scopeCountry: string | null; scopeCity: string | null }, 'businesses', businessId))) {
      return { error: 'This review belongs to a business outside your chapter scope' }
    }
  }

  const { error } = await svc.from('reviews').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/reviews')
  return { error: null }
}

// ── Listing moderation ───────────────────────────────────────

export async function setBusinessStatusAdmin(
  id: string,
  status: 'draft' | 'published' | 'paused'
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (!ctx.role) return { error: 'Not authorized' }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }
  }

  const svc = adminDb()
  if (!(await targetInScope(svc, ctx as { role: 'chapter_admin' | 'super_admin'; scopeCountry: string | null; scopeCity: string | null }, 'businesses', id))) {
    return { error: 'This business is outside your chapter scope' }
  }

  const { error } = await svc.from('businesses').update({ status }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/listings')
  revalidatePath('/marketplace')
  // Also bust the owner's dashboard caches — without these, after admin
  // pauses + republishes a listing the owner's dashboard keeps serving
  // the prior cached state and the business appears to have vanished.
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/services')
  revalidatePath('/dashboard/business/edit')
  return { error: null }
}

/**
 * Permanent admin delete of a listing.
 *
 * Caller must pass the business's exact name as `confirmName` to guard
 * against accidental deletes — same friction as the owner-side delete.
 *
 * Chapter admins can only delete businesses owned by members within their
 * scope (country + optional city). Super admin bypasses the scope check.
 *
 * Schema-level ON DELETE CASCADE handles services, listing_analytics,
 * reviews, and ad_campaigns. conversations.listing_id is set null so
 * past message threads survive without their listing reference.
 */
export async function deleteBusinessAdmin(
  id: string,
  confirmName: string
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (!ctx.role) return { error: 'Not authorized' }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }
  }

  const svc = adminDb()

  if (!(await targetInScope(svc, ctx as { role: 'chapter_admin' | 'super_admin'; scopeCountry: string | null; scopeCity: string | null }, 'businesses', id))) {
    return { error: 'This business is outside your chapter scope' }
  }

  // Re-verify the typed name on the server. Don't trust the client to
  // have done this gate correctly.
  const { data: biz } = await svc
    .from('businesses')
    .select('id, name')
    .eq('id', id)
    .maybeSingle() as { data: { id: string; name: string } | null }

  if (!biz) return { error: 'Business not found' }
  if (biz.name.trim().toLowerCase() !== confirmName.trim().toLowerCase()) {
    return { error: `Type the business name exactly to confirm: "${biz.name}"` }
  }

  const { error } = await svc.from('businesses').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/admin/listings')
  revalidatePath('/marketplace')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/services')
  revalidatePath('/dashboard/business/edit')
  return { error: null }
}

// ── Transfer listing ownership (super_admin only) ───────────

export interface MemberSearchResult {
  id: string
  full_name: string | null
  eo_membership_email: string | null
  avatar_url: string | null
  eo_chapter: string | null
  chapter_country: string | null
  chapter_city: string | null
}

/**
 * Typeahead search for the transfer-ownership picker. Matches on name
 * and membership email. Caps results at 20.
 *
 * super_admin only — chapter admins shouldn't be moving listings around.
 */
export async function searchMembersForTransfer(query: string): Promise<{
  error: string | null
  results: MemberSearchResult[]
}> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error, results: [] }
  if (ctx.role !== 'super_admin') return { error: 'Super admin only', results: [] }

  const q = query.trim()
  if (q.length < 2) return { error: null, results: [] }
  // Reject control characters that would break the PostgREST `or` filter
  // syntax (commas, parens, dots are structural separators). We can't
  // safely escape them with the current PostgREST filter grammar — easier
  // to refuse than risk an injection.
  if (/[,()*]/.test(q)) return { error: null, results: [] }

  // Escape ilike wildcards so a user typing '%' doesn't match everything.
  const safe = q.replace(/[%_\\]/g, m => '\\' + m)
  const { data, error } = await ctx.db
    .from('profiles')
    .select('id, full_name, eo_membership_email, avatar_url, eo_chapter, chapter_country, chapter_city')
    .or(`full_name.ilike.%${safe}%,eo_membership_email.ilike.%${safe}%`)
    .limit(20) as { data: MemberSearchResult[] | null; error: { message: string } | null }

  if (error) return { error: error.message, results: [] }
  return { error: null, results: data ?? [] }
}

/**
 * Re-assign a business listing to a different member.
 *
 * Updates `businesses.owner_id` only. Conversations are deliberately NOT
 * re-routed — past message threads stay attributed to the previous owner
 * (history is preserved). New inquiries land in the new owner's inbox
 * because the listing now points at them.
 *
 * super_admin only. Refuses if the target user has no profile row, isn't
 * a real EO member, or is the same as the current owner.
 */
export async function transferBusinessOwnership(
  businessId: string,
  newOwnerId: string
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (ctx.role !== 'super_admin') return { error: 'Super admin only' }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }
  }

  const svc = adminDb()

  // Verify the business exists and grab the current owner.
  const { data: biz } = await svc
    .from('businesses')
    .select('id, name, owner_id')
    .eq('id', businessId)
    .maybeSingle() as { data: { id: string; name: string; owner_id: string } | null }
  if (!biz) return { error: 'Business not found' }
  if (biz.owner_id === newOwnerId) return { error: 'Already owned by this member' }

  // Verify the new owner has a profile (i.e. is a real registered member,
  // not an arbitrary UUID). Also surfaces a friendlier name in the result.
  const { data: newOwner } = await svc
    .from('profiles')
    .select('id, full_name, status')
    .eq('id', newOwnerId)
    .maybeSingle() as { data: { id: string; full_name: string | null; status: string } | null }
  if (!newOwner) return { error: 'New owner not found in members directory' }
  if (newOwner.status === 'suspended') return { error: 'Cannot transfer to a suspended member' }

  const { error } = await svc
    .from('businesses')
    .update({ owner_id: newOwnerId })
    .eq('id', businessId)
  if (error) return { error: error.message }

  revalidatePath('/admin/listings')
  revalidatePath('/marketplace')
  revalidatePath(`/marketplace/${businessId}`)
  // Both old and new owners' dashboards need to reflect the change.
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/services')
  revalidatePath('/dashboard/business/edit')
  return { error: null }
}

// ── Chapter admin scope assignment (super_admin only) ────────

export async function setChapterAdminScope(
  userId: string,
  scope: { country: string | null; city: string | null }
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (ctx.role !== 'super_admin') return { error: 'Super admin only' }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }
  }

  const { data, error } = await adminDb()
    .from('profiles')
    .update({
      admin_scope_country: scope.country || null,
      admin_scope_city: scope.city || null,
    })
    .eq('id', userId)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'No profile updated — user not found' }
  revalidatePath('/admin/members')
  return { error: null }
}
