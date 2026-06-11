import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { matchAndNotify } from '@/lib/bulletin/match-and-notify'
import { siteUrl } from '@/lib/site-url'
import { currentTenant } from '@/lib/tenant'
import type { ClassificationResult } from './classifier'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface CreateBulletinInput {
  classification: ClassificationResult
  shadowUserId: string
  memberId: string
}

interface CreateBulletinResult {
  postId: string | null
  matchedCount: number
  error?: string
}

export async function createBulletinFromClassification(
  input: CreateBulletinInput
): Promise<CreateBulletinResult> {
  const extracted = input.classification.extracted
  if (!extracted) {
    return { postId: null, matchedCount: 0, error: 'no_extracted_data' }
  }

  const db = adminDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  // WhatsApp posts expire 14 days from creation
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

  const today = new Date().toISOString().split('T')[0]
  const requiredBy = extracted.required_by >= today
    ? extracted.required_by
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const { data: post, error: postErr } = await dbAny
    .from('bulletin_posts')
    .insert({
      member_id: input.memberId,
      board_type: 'business',
      title: extracted.title.slice(0, 120),
      detail: extracted.detail.slice(0, 2000) || null,
      category: extracted.category || 'General',
      tags: extracted.tags ?? [],
      geography_country: extracted.country || null,
      geography_city: extracted.city || null,
      required_by: requiredBy,
      status: 'open',
      source: 'whatsapp',
      shadow_user_id: input.shadowUserId,
      expires_at: expiresAt,
      tenant_id: currentTenant(),
    })
    .select('id')
    .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }

  if (postErr || !post) {
    console.error('[mm-client] bulletin_posts insert failed:', postErr?.message)
    return { postId: null, matchedCount: 0, error: postErr?.message ?? 'insert_failed' }
  }

  // During the WhatsApp testing phase we suppress member match-emails so real
  // members aren't notified. Controlled by the whatsapp_match_emails_enabled
  // feature flag (default OFF / suppressed); flip it on to go live, no redeploy.
  const { data: emailFlag } = await dbAny
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', 'whatsapp_match_emails_enabled')
    .maybeSingle() as { data: { is_enabled: boolean } | null }
  const suppressEmails = !emailFlag?.is_enabled

  // Run matching engine — emails relevant businesses unless suppressed
  const matched = await matchAndNotify({
    postId: post.id,
    tags: extracted.tags ?? [],
    detail: extracted.detail,
    country: extracted.country || '',
    city: extracted.city || null,
    postTitle: extracted.title,
    posterName: 'An EO member (via WhatsApp)',
    siteUrl: siteUrl(),
    suppressEmails,
  })

  if (matched.length > 0) {
    await dbAny
      .from('bulletin_posts')
      .update({ matched_business_ids: matched.map(m => m.id) })
      .eq('id', post.id)
  }

  return { postId: post.id, matchedCount: matched.length }
}
