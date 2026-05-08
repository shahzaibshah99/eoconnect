'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { isInChapterScope } from '@/lib/chapter-scope'
import { isAssignableTag, VERIFICATION_TAG_LABEL, type AssignableTag } from '@/lib/verification-tags'
import {
  sendEmail,
  verificationApprovedEmail,
  verificationRejectedEmail,
  verificationResubmitEmail,
} from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'
import { currentTenant, type TenantId } from '@/lib/tenant'
import { scrapeProfileForMembership } from '@/lib/linkedin-verification-scrape'
import { notifyMember } from '@/lib/verification-gate'

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

  const { data: inserted, error } = await ctx.db
    .from('categories')
    .insert({ ...parsed.data, active: true })
    .select('id')
    .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }
  if (error) return { error: error.message }
  await logEvent(adminDb(), 'category_created', ctx.user!.id, inserted?.id ?? null, parsed.data)
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
  await logEvent(adminDb(), 'category_updated', ctx.user!.id, id, parsed.data)
  revalidatePath('/admin/categories')
  return { error: null }
}

export async function toggleCategoryActive(id: string, active: boolean): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (ctx.role !== 'super_admin') return { error: 'Super admin only' }

  const { error } = await ctx.db.from('categories').update({ active }).eq('id', id)
  if (error) return { error: error.message }
  await logEvent(adminDb(), active ? 'category_activated' : 'category_deactivated', ctx.user!.id, id, { active })
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
  await logEvent(svc, 'member_status_changed', ctx.user!.id, userId, { status })
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
  const svc = adminDb()
  const { data, error } = await svc
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'No profile updated — user not found' }
  await logEvent(svc, 'member_role_changed', ctx.user!.id, userId, { role })
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
  await logEvent(svc, 'review_unflagged', ctx.user!.id, id, {})
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

  // Look up business id BEFORE the delete for log context. After delete
  // the FK trail is gone — capture it now.
  const businessId = await reviewBusinessId(svc, id)

  const { error } = await svc.from('reviews').delete().eq('id', id)
  if (error) return { error: error.message }
  await logEvent(svc, 'review_deleted', ctx.user!.id, id, { business_id: businessId })
  revalidatePath('/admin/reviews')
  // Listing pages cache the review list — bust them too so the admin
  // delete shows up immediately on the public-facing page.
  revalidatePath('/marketplace', 'layout')
  return { error: null }
}

/**
 * Admin-only edit of a review's rating and body.
 *
 * Members can no longer self-edit reviews after submitting (PR
 * /feat-reviews-redesign). The expectation is that members contact
 * the EO team when something needs correcting and an admin fixes it
 * here. Surfaced through /admin/reviews.
 *
 * Chapter admins can only edit reviews on businesses within their
 * scope (same rule as deleteReview above). Super admins bypass.
 */
const AdminEditReviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  body: z.string().trim().min(1, 'Body required').max(500, 'Max 500 characters'),
})

export async function adminUpdateReview(
  id: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (ctx.error) return { error: ctx.error }
  if (!ctx.role) return { error: 'Not authorized' }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }
  }

  const parsed = AdminEditReviewSchema.safeParse({
    rating: formData.get('rating'),
    body: formData.get('body'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()
  if (ctx.role === 'chapter_admin') {
    const businessId = await reviewBusinessId(svc, id)
    if (!businessId) return { error: 'Review not found' }
    if (!(await targetInScope(svc, ctx as { role: 'chapter_admin'; scopeCountry: string | null; scopeCity: string | null }, 'businesses', businessId))) {
      return { error: 'This review belongs to a business outside your chapter scope' }
    }
  }

  const { error } = await svc
    .from('reviews')
    .update({ rating: parsed.data.rating, body: parsed.data.body })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/reviews')
  revalidatePath('/marketplace', 'layout')
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

  // Stamp pause provenance in lockstep with status. When an admin pauses,
  // we record paused_by='admin' so the member-side updateBusinessStatus
  // refuses to resume it — preserving the moderation hold. When status
  // moves off 'paused' we always clear paused_by, regardless of who
  // originally set it (an admin resume is the canonical override).
  const updateData: { status: typeof status; paused_by: 'owner' | 'admin' | null } = {
    status,
    paused_by: status === 'paused' ? 'admin' : null,
  }

  const { error } = await svc.from('businesses').update(updateData).eq('id', id)
  if (error) return { error: error.message }
  await logEvent(svc, 'business_status_changed', ctx.user!.id, id, { status })
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
  await logEvent(svc, 'business_deleted', ctx.user!.id, id, { name: biz.name })

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
  await logEvent(svc, 'business_ownership_transferred', ctx.user!.id, businessId, {
    name: biz.name,
    old_owner_id: biz.owner_id,
    new_owner_id: newOwnerId,
  })

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

  const svc = adminDb()
  const { data, error } = await svc
    .from('profiles')
    .update({
      admin_scope_country: scope.country || null,
      admin_scope_city: scope.city || null,
    })
    .eq('id', userId)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'No profile updated — user not found' }
  await logEvent(svc, 'chapter_admin_scope_set', ctx.user!.id, userId, {
    country: scope.country ?? null,
    city: scope.city ?? null,
  })
  revalidatePath('/admin/members')
  return { error: null }
}

// ── Verification queue (super_admin only) ────────────────────
//
// Per scope doc F15: App Admin reviews verification submissions, sees
// LinkedIn pre-validation signal alongside, and assigns the verification
// tag on approval. Approval cascades the tag to the member's owned
// businesses so search ranking reflects it everywhere.
//
// Chapter admins are intentionally NOT permitted here — verification is
// a platform-wide trust signal, not a chapter-scoped action.

async function requireSuperAdmin() {
  const ctx = await requireAdmin()
  if (ctx.error) return { ...ctx, ok: false as const }
  if (ctx.role !== 'super_admin') {
    return { ...ctx, ok: false as const, error: 'Super admin only' as const }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ...ctx, ok: false as const, error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' as const }
  }
  return { ...ctx, ok: true as const }
}

async function logEvent(
  svc: ReturnType<typeof adminDb>,
  type: string,
  adminId: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
  tenantId?: string
) {
  const tenant = tenantId ?? currentTenant()
  // Best-effort audit log — never block the action if this insert fails
  // (e.g. transient DB blip). The action result is what matters; the
  // audit row is supplementary.
  // Best-effort but loud — failures log to server console so type
  // mismatches and missing columns get caught early instead of silently
  // dropping audit rows.
  const { error } = await svc.from('events_log').insert({
    type,
    member_id: adminId,
    entity_id: entityId,
    metadata,
    tenant_id: tenant,
  })
  if (error) {
    console.error(`[audit] events_log insert failed for type=${type}:`, error.message, { metadata })
  }
}

/**
 * Look up a member's display name + delivery email for transactional
 * mail. Falls back to auth email when eo_membership_email is missing
 * (some pre-populated profiles won't have it set).
 */
async function getMemberContact(
  svc: ReturnType<typeof adminDb>,
  memberId: string
): Promise<{ email: string | null; name: string }> {
  const { data: profile } = await svc
    .from('profiles')
    .select('full_name, eo_membership_email')
    .eq('id', memberId)
    .maybeSingle() as { data: { full_name: string | null; eo_membership_email: string | null } | null }

  let email = profile?.eo_membership_email ?? null
  if (!email) {
    // Fall back to the auth.users record. Service role can read it.
    const { data: auth } = await svc.auth.admin.getUserById(memberId)
    email = auth?.user?.email ?? null
  }
  return { email, name: profile?.full_name ?? 'there' }
}

export async function approveVerification(
  verificationId: string,
  tag: AssignableTag
): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (!ctx.ok) return { error: ctx.error ?? 'Not authorized' }
  if (!isAssignableTag(tag)) return { error: 'Invalid verification tag' }

  const svc = adminDb()

  // Fetch the verification to learn the member and tenant. Need both for
  // the cascade write and for events_log tenant scoping.
  const { data: row } = await svc
    .from('verifications')
    .select('id, member_id, tenant_id, status')
    .eq('id', verificationId)
    .maybeSingle() as { data: { id: string; member_id: string; tenant_id: string; status: string } | null }
  if (!row) return { error: 'Verification not found' }
  if (row.status === 'approved') return { error: 'Already approved' }

  // Tag must match the member's tenant — refuse cross-tenant assignments
  // (e.g. assigning ypo_member to an EO member).
  const tagPrefix = tag.startsWith('eo_') ? 'eo' : 'ypo'
  if (tagPrefix !== row.tenant_id) {
    return { error: `Tag ${tag} does not match member tenant ${row.tenant_id}` }
  }

  // 1. Mark the verification approved.
  const { error: vErr } = await svc
    .from('verifications')
    .update({
      status: 'approved',
      reviewed_by: ctx.user!.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', verificationId)
  if (vErr) return { error: vErr.message }

  // 2. Stamp the tag on the member's profile.
  const { error: pErr } = await svc
    .from('profiles')
    .update({ verification_tag: tag })
    .eq('id', row.member_id)
  if (pErr) return { error: pErr.message }

  // 3. Cascade tag to all of the member's owned businesses so search
  //    ranking sees the right tier. Per F02 in the scope doc.
  const { error: bErr } = await svc
    .from('businesses')
    .update({ verification_tag: tag })
    .eq('owner_id', row.member_id)
  if (bErr) return { error: bErr.message }

  await logEvent(svc, 'verification_approved', ctx.user!.id, verificationId, {
    member_id: row.member_id,
    tag,
  }, row.tenant_id)

  // Notify member. Best-effort — email failure must not roll back the
  // approval that has already been written to all three tables above.
  const contact = await getMemberContact(svc, row.member_id)
  if (contact.email) {
    const tpl = verificationApprovedEmail(contact.name, VERIFICATION_TAG_LABEL[tag], siteUrl())
    sendEmail({ to: contact.email, subject: tpl.subject, html: tpl.html }).catch(err => {
      console.error('verification approved email failed:', err)
    })
  }

  // In-app notification (per marketing-lead feedback). Members see
  // this in the navbar bell even if they don't read email.
  await notifyMember({
    userId: row.member_id,
    type: 'verification_approved',
    title: `You're verified — ${VERIFICATION_TAG_LABEL[tag]}`,
    body: 'Your member profile is verified and your listings now show your tier in search.',
    link: '/dashboard',
  })

  revalidatePath('/admin/verifications')
  revalidatePath('/admin/members')
  revalidatePath('/marketplace')
  return { error: null }
}

const RejectSchema = z.object({
  reason: z.string().trim().min(3, 'Reason is required').max(500),
})

export async function rejectVerification(
  verificationId: string,
  reason: string
): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (!ctx.ok) return { error: ctx.error ?? 'Not authorized' }

  const parsed = RejectSchema.safeParse({ reason })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()
  const { data: row } = await svc
    .from('verifications')
    .select('id, member_id, tenant_id, status')
    .eq('id', verificationId)
    .maybeSingle() as { data: { id: string; member_id: string; tenant_id: string; status: string } | null }
  if (!row) return { error: 'Verification not found' }

  const { error } = await svc
    .from('verifications')
    .update({
      status: 'rejected',
      rejection_reason: parsed.data.reason,
      reviewed_by: ctx.user!.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', verificationId)
  if (error) return { error: error.message }

  // Per marketing-lead feedback: rejection auto-suspends the account
  // and stores the reason for the /suspended page to display.
  await svc
    .from('profiles')
    .update({
      status: 'suspended',
      suspension_reason: parsed.data.reason,
    })
    .eq('id', row.member_id)

  await logEvent(svc, 'verification_rejected', ctx.user!.id, verificationId, {
    member_id: row.member_id,
    reason: parsed.data.reason,
    auto_suspended: true,
  }, row.tenant_id)

  const contact = await getMemberContact(svc, row.member_id)
  if (contact.email) {
    const tpl = verificationRejectedEmail(contact.name, parsed.data.reason, siteUrl())
    sendEmail({ to: contact.email, subject: tpl.subject, html: tpl.html }).catch(err => {
      console.error('verification rejected email failed:', err)
    })
  }

  await notifyMember({
    userId: row.member_id,
    type: 'verification_rejected',
    title: 'Verification rejected — account suspended',
    body: parsed.data.reason,
    link: '/suspended',
  })

  // Cache bust the layout so the suspended state takes effect on
  // the member's next nav action.
  revalidatePath('/', 'layout')

  revalidatePath('/admin/verifications')
  return { error: null }
}

export async function requestVerificationResubmission(
  verificationId: string,
  note: string
): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (!ctx.ok) return { error: ctx.error ?? 'Not authorized' }

  // Note doubles as guidance to the member — same validation as reject reason.
  const parsed = RejectSchema.safeParse({ reason: note })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const svc = adminDb()
  const { data: row } = await svc
    .from('verifications')
    .select('id, member_id, tenant_id, status')
    .eq('id', verificationId)
    .maybeSingle() as { data: { id: string; member_id: string; tenant_id: string; status: string } | null }
  if (!row) return { error: 'Verification not found' }

  const { error } = await svc
    .from('verifications')
    .update({
      status: 'resubmit',
      rejection_reason: parsed.data.reason,
      reviewed_by: ctx.user!.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', verificationId)
  if (error) return { error: error.message }

  await logEvent(svc, 'verification_resubmit_requested', ctx.user!.id, verificationId, {
    member_id: row.member_id,
    note: parsed.data.reason,
  }, row.tenant_id)

  const contact = await getMemberContact(svc, row.member_id)
  if (contact.email) {
    const tpl = verificationResubmitEmail(contact.name, parsed.data.reason, siteUrl())
    sendEmail({ to: contact.email, subject: tpl.subject, html: tpl.html }).catch(err => {
      console.error('verification resubmit email failed:', err)
    })
  }

  await notifyMember({
    userId: row.member_id,
    type: 'verification_resubmit_requested',
    title: 'Please resubmit your verification',
    body: parsed.data.reason,
    link: '/dashboard/verify',
  })

  revalidatePath('/admin/verifications')
  return { error: null }
}

/**
 * Manually set the LinkedIn signal value on a verification row. Used
 * when the automated scrape couldn't run or returned a value the admin
 * wants to override after eyeballing the LinkedIn URL themselves.
 *
 * The scrape itself runs out-of-band (worker / cron) and writes the same
 * column; this is just the admin override path.
 */
export async function setVerificationLinkedInSignal(
  verificationId: string,
  signal: 'yes' | 'no' | 'unclear' | null
): Promise<{ error: string | null }> {
  const ctx = await requireSuperAdmin()
  if (!ctx.ok) return { error: ctx.error ?? 'Not authorized' }

  const svc = adminDb()
  const { error } = await svc
    .from('verifications')
    .update({ linkedin_signal: signal })
    .eq('id', verificationId)
  if (error) return { error: error.message }
  await logEvent(svc, 'verification_linkedin_signal_set', ctx.user!.id, verificationId, { signal })

  revalidatePath('/admin/verifications')
  return { error: null }
}

/**
 * Re-trigger the LinkedIn auto-scrape for an existing verification row.
 * Used when the scrape failed at submit time (RapidAPI was down, key
 * was missing, etc.) or when the admin wants a fresh read after the
 * member updated their LinkedIn profile.
 *
 * Synchronous from the admin's perspective — the queue refresh shows
 * the new signal immediately. Doesn't fire any emails or modify status.
 */
export async function rescrapeLinkedInSignal(
  verificationId: string
): Promise<{ error: string | null; signal?: 'yes' | 'no' | 'unclear' | null }> {
  const ctx = await requireSuperAdmin()
  if (!ctx.ok) return { error: ctx.error ?? 'Not authorized' }

  const svc = adminDb()
  const { data: row } = await svc
    .from('verifications')
    .select('id, tenant_id, linkedin_url')
    .eq('id', verificationId)
    .maybeSingle() as { data: { id: string; tenant_id: string; linkedin_url: string | null } | null }
  if (!row) return { error: 'Verification not found' }
  if (!row.linkedin_url) return { error: 'No LinkedIn URL on this submission' }

  const signal = await scrapeProfileForMembership(row.linkedin_url, row.tenant_id as TenantId)

  const { error } = await svc
    .from('verifications')
    .update({ linkedin_signal: signal })
    .eq('id', verificationId)
  if (error) return { error: error.message }

  await logEvent(svc, 'verification_linkedin_signal_set', ctx.user!.id, verificationId, {
    signal,
    via: 'rescrape',
  }, row.tenant_id)

  revalidatePath('/admin/verifications')
  return { error: null, signal }
}
