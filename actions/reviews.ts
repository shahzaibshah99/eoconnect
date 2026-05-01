'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { sendEmail, newReviewEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'

const ReviewSchema = z.object({
  business_id: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  body: z.string().trim().min(20, 'Review must be at least 20 characters').max(500, 'Max 500 characters'),
  // New optional context (migration 020). reviewer_business_id is
  // the reviewer's own business they did the work as; service_id is
  // the reviewed business's specific service the review is about.
  reviewer_business_id: z.string().uuid().optional(),
  service_id: z.string().uuid().optional(),
})

const ReplySchema = z.object({
  review_id: z.string().uuid(),
  reply: z.string().trim().min(1).max(500),
})

export async function submitReview(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Coerce empty strings to undefined so the optional() schema
  // doesn't try to validate them as UUIDs.
  const reviewer_business_id = (formData.get('reviewer_business_id') as string | null) || undefined
  const service_id = (formData.get('service_id') as string | null) || undefined

  const parsed = ReviewSchema.safeParse({
    business_id: formData.get('business_id'),
    rating: formData.get('rating'),
    body: formData.get('body'),
    reviewer_business_id,
    service_id,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Submit-once semantics: members can't self-edit. A duplicate
  // review (same reviewer + same business) returns a clear error.
  // Admins still have an edit path through the admin panel.
  const { error } = await db.from('reviews').insert({
    business_id: parsed.data.business_id,
    reviewer_id: user.id,
    rating: parsed.data.rating,
    body: parsed.data.body,
    reviewer_business_id: parsed.data.reviewer_business_id ?? null,
    service_id: parsed.data.service_id ?? null,
  }) as { error: { code?: string; message: string } | null }

  if (error) {
    // 23505 = unique_violation on (business_id, reviewer_id) — the
    // member already left a review on this listing.
    if (error.code === '23505') {
      return { error: "You've already reviewed this business. Reviews can't be edited — contact the EO team if you need a correction." }
    }
    return { error: error.message }
  }

  // Fire-and-forget email to the business owner
  void (async () => {
    try {
      const { data: biz } = await db.from('businesses').select('name, owner_id').eq('id', parsed.data.business_id).single() as {
        data: { name: string; owner_id: string } | null
      }
      if (!biz) return
      const { data: owner } = await db.from('profiles').select('eo_membership_email').eq('id', biz.owner_id).single() as {
        data: { eo_membership_email: string | null } | null
      }
      const { data: reviewer } = await db.from('profiles').select('full_name').eq('id', user.id).single() as {
        data: { full_name: string } | null
      }
      if (!owner?.eo_membership_email) return
      const tpl = newReviewEmail(reviewer?.full_name ?? 'A member', biz.name, parsed.data.rating, parsed.data.body, siteUrl(), parsed.data.business_id)
      await sendEmail({ to: owner.eo_membership_email, subject: tpl.subject, html: tpl.html })
    } catch (err) {
      console.error('review email failed:', err)
    }
  })()

  revalidatePath(`/marketplace/${parsed.data.business_id}`)
  return { error: null }
}

export async function replyToReview(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const parsed = ReplySchema.safeParse({
    review_id: formData.get('review_id'),
    reply: formData.get('reply'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { data: review } = await db
    .from('reviews')
    .select('business_id, business:businesses!business_id(owner_id)')
    .eq('id', parsed.data.review_id)
    .single() as { data: { business_id: string; business: { owner_id: string } } | null }

  if (!review || review.business.owner_id !== user.id) {
    return { error: 'Not authorized' }
  }

  const { error } = await db
    .from('reviews')
    .update({ owner_reply: parsed.data.reply })
    .eq('id', parsed.data.review_id)

  if (error) return { error: error.message }
  revalidatePath(`/marketplace/${review.business_id}`)
  return { error: null }
}

export async function flagReview(reviewId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await db.from('reviews').update({ flagged: true }).eq('id', reviewId)
  if (error) return { error: error.message }
  return { error: null }
}
