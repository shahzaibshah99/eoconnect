'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { currentTenant } from '@/lib/tenant'
import { requireVerified } from '@/lib/verification-gate'
import { reviewBulletinPost } from '@/lib/ai/review-bulletin-post'
import { sendEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'
import { VERIFICATION_TIER } from '@/lib/bulletin-constants'

function adminDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── Validation ────────────────────────────────────────────────

const PostSchema = z.object({
  title: z.string().trim().min(10, 'Title must be at least 10 characters').max(120),
  detail: z.string().trim().max(2000).optional().or(z.literal('')),
  category: z.string().trim().min(1, 'Category is required'),
  geography_country: z.string().trim().min(1, 'Country is required'),
  geography_city: z.string().trim().optional().or(z.literal('')),
  required_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required by must be a date (YYYY-MM-DD)'),
  tags: z.array(z.string()).max(20).optional(),
  board_type: z.enum(['business', 'community']).optional(),
})

const ReplySchema = z.object({
  post_id: z.string().uuid(),
  content: z.string().trim().min(1, 'Reply cannot be empty').max(2000),
})

// ── AI review step ─────────────────────────────────────────────

/**
 * Step 1 of the post wizard. Runs AI review on the draft post and
 * returns tags + feedback. Does NOT write to the DB — the member
 * sees the feedback and can either fix it or post anyway.
 *
 * Exported as a server action so the client form can call it on
 * the "Next →" click without page navigation.
 */
export async function reviewPost(input: unknown): Promise<{
  error: string | null
  feedback: string | null
  tags: string[]
  is_complete: boolean
}> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', feedback: null, tags: [], is_complete: true }

  const gate = await requireVerified(db, user.id)
  if (!gate.ok) return { error: gate.reason ?? 'Not allowed', feedback: null, tags: [], is_complete: true }

  const parsed = PostSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, feedback: null, tags: [], is_complete: true }
  }

  const geo = [parsed.data.geography_city, parsed.data.geography_country].filter(Boolean).join(', ')
  const result = await reviewBulletinPost({
    title: parsed.data.title,
    detail: parsed.data.detail ?? '',
    category: parsed.data.category,
    geography: geo,
    required_by: parsed.data.required_by,
  })

  return { error: null, ...result }
}

// ── Submit (Step 2) ────────────────────────────────────────────

/**
 * Step 2: Member confirms the post (with or without addressing AI
 * feedback). Creates the bulletin_post row, then fires the matching
 * engine to notify up to 6 relevant businesses by email.
 *
 * Returns the post ID and matched businesses for the receipt screen.
 */
export async function submitBulletinPost(input: unknown): Promise<{
  error: string | null
  post_id?: string
  matched_businesses?: Array<{ id: string; name: string }>
}> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const gate = await requireVerified(db, user.id)
  if (!gate.ok) return { error: gate.reason ?? 'Not allowed' }

  const parsed = PostSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Refuse if required_by is in the past.
  const today = new Date().toISOString().split('T')[0]
  if (parsed.data.required_by < today) {
    return { error: 'Required by date cannot be in the past' }
  }

  // Fetch poster's name for email notifications.
  const { data: poster } = await db
    .from('profiles')
    .select('full_name, eo_membership_email')
    .eq('id', user.id)
    .maybeSingle() as { data: { full_name: string | null; eo_membership_email: string | null } | null }

  // Insert the post.
  const { data: post, error: postErr } = await db
    .from('bulletin_posts')
    .insert({
      member_id: user.id,
      board_type: parsed.data.board_type ?? 'business',
      title: parsed.data.title,
      detail: parsed.data.detail || null,
      category: parsed.data.category,
      tags: parsed.data.tags ?? [],
      geography_country: parsed.data.geography_country,
      geography_city: parsed.data.geography_city || null,
      required_by: parsed.data.required_by,
      status: 'open',
      ai_reviewed_at: new Date().toISOString(),
      tenant_id: currentTenant(),
    })
    .select('id')
    .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }

  if (postErr || !post) return { error: postErr?.message ?? 'Failed to create post' }

  // ── Matching engine ──────────────────────────────────────────
  const matched = await matchAndNotify({
    postId: post.id,
    tags: parsed.data.tags ?? [],
    country: parsed.data.geography_country,
    city: parsed.data.geography_city ?? null,
    postTitle: parsed.data.title,
    posterName: poster?.full_name ?? 'An EO member',
    siteUrl: siteUrl(),
  })

  // Store matched IDs on the post for the receipt screen.
  if (matched.length > 0) {
    await db
      .from('bulletin_posts')
      .update({ matched_business_ids: matched.map(m => m.id) })
      .eq('id', post.id)
  }

  revalidatePath('/bulletin')
  return { error: null, post_id: post.id, matched_businesses: matched }
}

// ── Matching engine ────────────────────────────────────────────

async function matchAndNotify(input: {
  postId: string
  tags: string[]
  country: string
  city: string | null
  postTitle: string
  posterName: string
  siteUrl: string
}): Promise<Array<{ id: string; name: string }>> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return []
  const svc = adminDb()

  // Find published businesses whose tags overlap with the post tags.
  // Use service-role to bypass RLS — we're doing a platform-wide match.
  type BizRow = {
    id: string; name: string; owner_id: string; verification_tag: string | null;
    created_at: string; country: string | null;
    profiles: { eo_membership_email: string | null; full_name: string | null } | null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: candidates } = await (svc as any)
    .from('businesses')
    .select('id, name, owner_id, verification_tag, created_at, country, profiles!owner_id(eo_membership_email, full_name)')
    .eq('status', 'published')
    .eq('slow_replier', false)
    .overlaps('tags', input.tags.length > 0 ? input.tags : ['__no_match__'])
    .ilike('country', input.country)
    .limit(50) as { data: BizRow[] | null }

  if (!candidates || candidates.length === 0) return []

  // Sort by verification tier then recency. Slice to 6.
  const sorted = [...candidates].sort((a, b) => {
    const aTier = VERIFICATION_TIER[a.verification_tag ?? 'unverified'] ?? 99
    const bTier = VERIFICATION_TIER[b.verification_tag ?? 'unverified'] ?? 99
    if (aTier !== bTier) return aTier - bTier
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  }).slice(0, 6)

  const postUrl = `${input.siteUrl}/bulletin/${input.postId}`

  // Fire match emails — best-effort, don't block on failure.
  for (const biz of sorted) {
    const email = biz.profiles?.eo_membership_email
    if (!email) continue
    sendEmail({
      to: email,
      subject: `New business need matches your listing: "${input.postTitle}"`,
      html: bulletinMatchEmailHtml({
        businessName: biz.name,
        ownerName: biz.profiles?.full_name ?? 'there',
        postTitle: input.postTitle,
        posterName: input.posterName,
        postUrl,
      }),
    }).catch(err => console.error('[bulletin-match] email failed for', biz.id, err))
  }

  return sorted.map(b => ({ id: b.id, name: b.name }))
}

function bulletinMatchEmailHtml(input: {
  businessName: string
  ownerName: string
  postTitle: string
  posterName: string
  postUrl: string
}) {
  const { businessName, ownerName, postTitle, posterName, postUrl } = input
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9f6f0;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
    <h1 style="font-size:18px;margin:0 0 12px;">Hi ${esc(ownerName)} — a member posted a need that matches ${esc(businessName)}</h1>
    <div style="background:#f4f1ec;border-left:4px solid #0A5C46;padding:12px 16px;margin:16px 0;border-radius:0 8px 8px 0;">
      <p style="margin:0;font-size:15px;font-weight:600;">${esc(postTitle)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#666;">Posted by ${esc(posterName)}</p>
    </div>
    <p style="font-size:14px;color:#444;line-height:1.5;">
      This member is looking for something your business may offer. View their full post and reply in the bulletin board.
    </p>
    <p style="margin-top:24px;">
      <a href="${postUrl}" style="background:#0A2218;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
        View the post &amp; reply
      </a>
    </p>
    <p style="font-size:12px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
      You received this because your Member Market listing matches this member's business need.
    </p>
  </div>
</body></html>`
}

// ── Replies ────────────────────────────────────────────────────

export async function replyToPost(input: unknown): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const gate = await requireVerified(db, user.id)
  if (!gate.ok) return { error: gate.reason ?? 'Not allowed' }

  const parsed = ReplySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Refuse reply on a closed post.
  const { data: post } = await db
    .from('bulletin_posts')
    .select('id, status, member_id')
    .eq('id', parsed.data.post_id)
    .maybeSingle() as { data: { id: string; status: string; member_id: string } | null }
  if (!post) return { error: 'Post not found' }
  if (post.status !== 'open') return { error: 'This post is no longer accepting replies' }

  const { data: reply, error } = await db
    .from('post_responses')
    .insert({
      post_id: parsed.data.post_id,
      responder_member_id: user.id,
      content: parsed.data.content,
      tenant_id: currentTenant(),
    })
    .select('id')
    .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }

  if (error) return { error: error.message }

  revalidatePath(`/bulletin/${parsed.data.post_id}`)
  return { error: null, id: reply?.id }
}

// ── Post lifecycle ─────────────────────────────────────────────

export async function markFulfilled(postId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: post } = await db
    .from('bulletin_posts')
    .select('id, member_id, status')
    .eq('id', postId)
    .maybeSingle() as { data: { id: string; member_id: string; status: string } | null }
  if (!post) return { error: 'Post not found' }
  if (post.member_id !== user.id) return { error: 'Only the post author can mark it fulfilled' }
  if (post.status !== 'open') return { error: `Post is already ${post.status}` }

  const { error } = await db
    .from('bulletin_posts')
    .update({ status: 'fulfilled' })
    .eq('id', postId)
  if (error) return { error: error.message }

  revalidatePath(`/bulletin/${postId}`)
  revalidatePath('/bulletin')
  return { error: null }
}

export async function extendPost(postId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: post } = await db
    .from('bulletin_posts')
    .select('id, member_id, status, required_by')
    .eq('id', postId)
    .maybeSingle() as { data: { id: string; member_id: string; status: string; required_by: string } | null }
  if (!post) return { error: 'Post not found' }
  if (post.member_id !== user.id) return { error: 'Only the post author can extend it' }
  if (post.status !== 'open') return { error: 'Only open posts can be extended' }

  // Extend by 14 days from current required_by.
  const current = new Date(post.required_by)
  current.setDate(current.getDate() + 14)
  const newDate = current.toISOString().split('T')[0]

  const { error } = await db
    .from('bulletin_posts')
    .update({ required_by: newDate, expiry_warned_at: null })
    .eq('id', postId)
  if (error) return { error: error.message }

  revalidatePath(`/bulletin/${postId}`)
  return { error: null }
}
