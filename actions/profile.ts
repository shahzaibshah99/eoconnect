'use server'

import { createClient } from '@/lib/supabase/server'
import { uploadFile } from '@/lib/storage'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const ProfileSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name required'),
  eo_chapter: z.string().trim().min(1, 'EO chapter required'),
  eo_membership_type: z.enum(['current_member', 'alumni', 'accelerator']),
  region: z.string().trim().min(1, 'Region required'),
  chapter_country: z.string().trim().nullable().optional(),
  chapter_city: z.string().trim().nullable().optional(),
  // Auto-prepend https:// for plain "linkedin.com/in/foo" entries.
  // Empty string passes through (field is optional).
  linkedin_url: z.preprocess(v => {
    if (typeof v !== 'string') return v
    const t = v.trim()
    if (!t) return ''
    if (/^https?:\/\//i.test(t)) return t
    return `https://${t}`
  }, z.string().regex(
    /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\//i,
    'Must be a linkedin.com URL'
  ).or(z.literal(''))).optional(),
  phone: z.string().trim().max(30).optional(),
  contact_show_email: z.enum(['true', 'false']).optional(),
  contact_show_phone: z.enum(['true', 'false']).optional(),
})

export async function updateProfile(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const parsed = ProfileSchema.safeParse({
    full_name: formData.get('full_name'),
    eo_chapter: formData.get('eo_chapter'),
    eo_membership_type: formData.get('eo_membership_type'),
    region: formData.get('region'),
    chapter_country: formData.get('chapter_country') || null,
    chapter_city: formData.get('chapter_city') || null,
    linkedin_url: formData.get('linkedin_url') ?? '',
    phone: formData.get('phone') ?? undefined,
    contact_show_email: formData.get('contact_show_email') ?? undefined,
    contact_show_phone: formData.get('contact_show_phone') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  let avatar_url: string | undefined
  try {
    const file = formData.get('avatar') as File | null
    if (file && file.size > 0) {
      avatar_url = await uploadFile('eoconnect-media', `avatars/${user.id}-${Date.now()}`, file)
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Avatar upload failed' }
  }

  const update: Record<string, unknown> = {
    full_name: parsed.data.full_name,
    eo_chapter: parsed.data.eo_chapter,
    eo_membership_type: parsed.data.eo_membership_type,
    region: parsed.data.region,
    chapter_country: parsed.data.chapter_country || null,
    chapter_city: parsed.data.chapter_city || null,
    // Keep legacy `country` text in sync for back-compat with old reads.
    country: parsed.data.chapter_country || null,
    linkedin_url: parsed.data.linkedin_url || null,
    phone: parsed.data.phone || null,
    contact_visibility: {
      email: parsed.data.contact_show_email === 'true',
      phone: parsed.data.contact_show_phone === 'true',
    },
  }
  if (avatar_url) update.avatar_url = avatar_url

  const { error } = await db.from('profiles').update(update).eq('id', user.id)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/account')
  revalidatePath('/marketplace', 'layout')
  return { error: null }
}
