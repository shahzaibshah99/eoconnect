'use server'

import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { sendEmail, adApprovedEmail, adRejectedEmail } from '@/lib/email/send'
import { siteUrl } from '@/lib/site-url'

const CampaignSchema = z.object({
  format: z.enum(['banner', 'sponsored_listing']),
  goal: z.enum(['more_views', 'sponsored_search']),
  target_category_ids: z.array(z.string().uuid()).max(5),
  target_keywords: z.array(z.string().trim().min(1)).max(15),
  budget_total: z.coerce.number().min(10, 'Minimum budget is $10'),
  bid_cpc: z.coerce.number().min(0.10, 'Minimum bid is $0.10').max(50, 'Max bid is $50'),
  daily_pacing_cap: z.coerce.number().min(1).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  creative_url: z.string().url().optional().or(z.literal('')),
})

interface CreateCampaignResult {
  error: string | null
  campaign_id?: string
  checkout_url?: string
}

export async function createCampaign(formData: FormData): Promise<CreateCampaignResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: business } = await db
    .from('businesses')
    .select('id, name, status')
    .eq('owner_id', user.id)
    .maybeSingle() as { data: { id: string; name: string; status: string } | null }

  if (!business) return { error: 'Create a business profile before launching ads.' }
  if (business.status !== 'published') return { error: 'Your business listing must be published.' }

  const raw = {
    format: formData.get('format'),
    goal: formData.get('goal'),
    target_category_ids: formData.getAll('target_category_ids') as string[],
    target_keywords: ((formData.get('target_keywords') as string | null) ?? '')
      .split(',').map(s => s.trim()).filter(Boolean),
    budget_total: formData.get('budget_total'),
    bid_cpc: formData.get('bid_cpc'),
    daily_pacing_cap: formData.get('daily_pacing_cap') || undefined,
    start_date: formData.get('start_date') || undefined,
    end_date: formData.get('end_date') || undefined,
    creative_url: formData.get('creative_url') || undefined,
  }

  const parsed = CampaignSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { data: campaign, error } = await db
    .from('ad_campaigns')
    .insert({
      business_id: business.id,
      ...parsed.data,
      budget_daily: parsed.data.daily_pacing_cap ?? null,
      status: 'draft',
    })
    .select('id')
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (error || !campaign) return { error: error?.message ?? 'Failed to create campaign' }

  // If Stripe is configured, redirect to Checkout for budget payment
  const stripe = getStripe()
  if (stripe) {
    try {
      const origin = siteUrl()
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: `Member Market Ads — ${business.name}`, description: `Budget for campaign ${campaign.id}` },
            unit_amount: Math.round(parsed.data.budget_total * 100),
          },
          quantity: 1,
        }],
        success_url: `${origin}/dashboard/ads/${campaign.id}?payment=success`,
        cancel_url: `${origin}/dashboard/ads/${campaign.id}?payment=cancel`,
        metadata: { campaign_id: campaign.id, user_id: user.id },
      })
      await db.from('ad_campaigns')
        .update({ stripe_payment_intent_id: session.id })
        .eq('id', campaign.id)
      return { error: null, campaign_id: campaign.id, checkout_url: session.url ?? undefined }
    } catch (err) {
      console.error('stripe checkout failed:', err)
      return { error: 'Payment setup failed. Please try again.' }
    }
  }

  // No Stripe configured: mark as pending_review immediately (free preview mode)
  await db.from('ad_campaigns').update({ status: 'pending_review' }).eq('id', campaign.id)
  revalidatePath('/dashboard/ads')
  return { error: null, campaign_id: campaign.id }
}

export async function pauseCampaign(id: string): Promise<{ error: string | null }> {
  return setCampaignStatus(id, 'paused')
}
export async function resumeCampaign(id: string): Promise<{ error: string | null }> {
  return setCampaignStatus(id, 'active')
}

async function setCampaignStatus(
  id: string,
  status: 'active' | 'paused'
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: c } = await db
    .from('ad_campaigns').select('id, status, business:businesses!business_id(owner_id)')
    .eq('id', id).single() as { data: { id: string; status: string; business: { owner_id: string } } | null }
  if (!c || c.business.owner_id !== user.id) return { error: 'Not authorized' }

  // Can only resume from paused (not from draft/pending_review/completed)
  if (status === 'active' && c.status !== 'paused') return { error: `Cannot resume a ${c.status} campaign` }

  const { error } = await db.from('ad_campaigns').update({ status }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/ads')
  revalidatePath(`/dashboard/ads/${id}`)
  return { error: null }
}

export async function approveCampaign(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).single() as {
    data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null
  }
  if (!me || !['chapter_admin', 'super_admin'].includes(me.role)) return { error: 'Not authorized' }

  const { error } = await db.from('ad_campaigns').update({ status: 'active', rejection_reason: null }).eq('id', id)
  if (error) return { error: error.message }

  void notifyOwner(id, 'approved')

  revalidatePath('/admin/ads')
  return { error: null }
}

export async function rejectCampaign(id: string, reason: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).single() as {
    data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null
  }
  if (!me || !['chapter_admin', 'super_admin'].includes(me.role)) return { error: 'Not authorized' }

  const finalReason = reason || 'Did not meet platform guidelines.'
  const { error } = await db
    .from('ad_campaigns')
    .update({ status: 'rejected', rejection_reason: finalReason })
    .eq('id', id)
  if (error) return { error: error.message }

  void notifyOwner(id, 'rejected', finalReason)

  revalidatePath('/admin/ads')
  return { error: null }
}

async function notifyOwner(campaignId: string, kind: 'approved' | 'rejected', reason?: string) {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data: c } = await db
      .from('ad_campaigns')
      .select('id, business:businesses!business_id(name, owner_id)')
      .eq('id', campaignId)
      .single() as { data: { id: string; business: { name: string; owner_id: string } } | null }
    if (!c) return
    const { data: owner } = await db
      .from('profiles')
      .select('eo_membership_email')
      .eq('id', c.business.owner_id)
      .single() as { data: { eo_membership_email: string | null } | null }
    if (!owner?.eo_membership_email) return
    const url = siteUrl()
    const tpl = kind === 'approved'
      ? adApprovedEmail(c.business.name, url, c.id)
      : adRejectedEmail(c.business.name, reason ?? 'Did not meet guidelines', url, c.id)
    await sendEmail({ to: owner.eo_membership_email, subject: tpl.subject, html: tpl.html })
  } catch (err) {
    console.error('ad notify failed:', err)
  }
}

export async function topUpCampaign(id: string, amount: number): Promise<{ error: string | null; checkout_url?: string }> {
  if (amount < 10) return { error: 'Minimum top-up is $10' }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: c } = await db
    .from('ad_campaigns').select('id, business:businesses!business_id(owner_id, name)')
    .eq('id', id).single() as { data: { id: string; business: { owner_id: string; name: string } } | null }
  if (!c || c.business.owner_id !== user.id) return { error: 'Not authorized' }

  const stripe = getStripe()
  if (!stripe) return { error: 'Payments not configured' }

  try {
    const origin = siteUrl()
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Member Market Ads — Top up`, description: `Add to budget of campaign ${id}` },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      success_url: `${origin}/dashboard/ads/${id}?payment=topup-success`,
      cancel_url: `${origin}/dashboard/ads/${id}`,
      metadata: { campaign_id: id, user_id: user.id, kind: 'topup', amount: String(amount) },
    })
    return { error: null, checkout_url: session.url ?? undefined }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Stripe error' }
  }
}

export async function deleteCampaignDraft(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: c } = await db
    .from('ad_campaigns').select('id, status, business:businesses!business_id(owner_id)')
    .eq('id', id).single() as { data: { id: string; status: string; business: { owner_id: string } } | null }
  if (!c || c.business.owner_id !== user.id) return { error: 'Not authorized' }
  if (c.status !== 'draft') return { error: 'Can only delete drafts' }

  const { error } = await db.from('ad_campaigns').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/ads')
  return { error: null }
}
