'use server'

import { createClient } from '@/lib/supabase/server'
import { uploadFile } from '@/lib/storage'
import { refreshBusinessEmbedding } from '@/lib/ai/refresh-business-embedding'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const ServiceSchema = z.object({
  title: z.string().min(3, 'Service title required'),
  description: z.string().optional(),
  pricing_model: z.enum(['fixed', 'hourly', 'project', 'contact']),
  price_from: z.coerce.number().min(0).optional(),
  price_to: z.coerce.number().min(0).optional(),
})

export type ServiceActionResult = { error: string | null; id?: string }

async function isAdmin(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data } = await db.from('profiles').select('role').eq('id', userId).single() as {
    data: { role: 'member' | 'chapter_admin' | 'super_admin' } | null
  }
  return !!data && ['chapter_admin', 'super_admin'].includes(data.role)
}

async function uploadThumbnailIfPresent(formData: FormData, userId: string): Promise<string | undefined> {
  const file = formData.get('thumbnail') as File | null
  if (!file || file.size === 0) return undefined
  return uploadFile('eoconnect-media', `services/${userId}-${Date.now()}`, file)
}

export async function createService(business_id: string, formData: FormData): Promise<ServiceActionResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const admin = await isAdmin(supabase, user.id)

  const { data: business } = await db
    .from('businesses')
    .select('id, owner_id')
    .eq('id', business_id)
    .single() as { data: { id: string; owner_id: string } | null }

  if (!business) return { error: 'Business not found' }
  if (!admin && business.owner_id !== user.id) return { error: 'Not authorized' }

  // MM-07: Hard cap of 3 services per business listing
  const { count: existingCount } = await db
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', business_id) as { count: number | null }
  if (existingCount !== null && existingCount >= 3) {
    return { error: 'Maximum 3 services per business. Delete an existing service to add a new one.' }
  }

  const parsed = ServiceSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    pricing_model: formData.get('pricing_model'),
    price_from: formData.get('price_from'),
    price_to: formData.get('price_to'),
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Block duplicate titles under the same business. The DB has a partial
  // unique index (migration 013) that's the real backstop against races,
  // but checking up-front lets us surface a friendlier error than the raw
  // "duplicate key value violates unique constraint" message.
  const normalizedTitle = parsed.data.title.trim().toLowerCase()
  const { data: existing } = await db
    .from('services')
    .select('id')
    .eq('business_id', business_id)
    .ilike('title', normalizedTitle)
    .limit(1) as { data: Array<{ id: string }> | null }
  if (existing && existing.length > 0) {
    return { error: 'A service with this title already exists for this business.' }
  }

  let thumbnail_url: string | undefined
  try {
    thumbnail_url = await uploadThumbnailIfPresent(formData, user.id)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Thumbnail upload failed' }
  }

  const { data, error } = await db
    .from('services')
    .insert({ ...parsed.data, business_id, thumbnail_url, status: 'published' })
    .select('id')
    .single() as { data: { id: string } | null; error: { code?: string; message: string } | null }

  if (error) {
    // 23505 = Postgres unique_violation. Catch the race that slipped past
    // the pre-check (two concurrent inserts) and translate it back into
    // the same friendly message.
    if (error.code === '23505') {
      return { error: 'A service with this title already exists for this business.' }
    }
    return { error: error.message }
  }
  if (!data) return { error: 'Failed to create service' }
  void refreshBusinessEmbedding(db, business_id)
  revalidatePath('/dashboard/services')
  revalidatePath(`/marketplace/${business_id}`)
  return { error: null, id: data.id }
}

export async function updateService(id: string, formData: FormData): Promise<ServiceActionResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const admin = await isAdmin(supabase, user.id)

  const { data: service } = await db
    .from('services')
    .select('id, business_id, businesses!inner(owner_id)')
    .eq('id', id)
    .single() as { data: { id: string; business_id: string; businesses: { owner_id: string } } | null }

  if (!service) return { error: 'Service not found' }
  if (!admin && service.businesses.owner_id !== user.id) return { error: 'Not authorized' }

  const parsed = ServiceSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    pricing_model: formData.get('pricing_model'),
    price_from: formData.get('price_from'),
    price_to: formData.get('price_to'),
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Same duplicate-title guard as createService, but excluding the row
  // we're updating (otherwise saving an unchanged title would always fail).
  const normalizedTitle = parsed.data.title.trim().toLowerCase()
  const { data: clash } = await db
    .from('services')
    .select('id')
    .eq('business_id', service.business_id)
    .ilike('title', normalizedTitle)
    .neq('id', id)
    .limit(1) as { data: Array<{ id: string }> | null }
  if (clash && clash.length > 0) {
    return { error: 'A service with this title already exists for this business.' }
  }

  const updateData: Record<string, unknown> = { ...parsed.data }
  try {
    const thumbnail_url = await uploadThumbnailIfPresent(formData, user.id)
    if (thumbnail_url) updateData.thumbnail_url = thumbnail_url
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Thumbnail upload failed' }
  }

  const { error } = await db
    .from('services')
    .update(updateData)
    .eq('id', id) as { error: { code?: string; message: string } | null }
  if (error) {
    if (error.code === '23505') {
      return { error: 'A service with this title already exists for this business.' }
    }
    return { error: error.message }
  }

  void refreshBusinessEmbedding(db, service.business_id)
  revalidatePath('/dashboard/services')
  revalidatePath(`/marketplace/${service.business_id}`)
  return { error: null }
}

export async function deleteService(id: string): Promise<ServiceActionResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const admin = await isAdmin(supabase, user.id)

  const { data: service } = await db
    .from('services')
    .select('id, business_id, businesses!inner(owner_id)')
    .eq('id', id)
    .single() as { data: { id: string; business_id: string; businesses: { owner_id: string } } | null }

  if (!service) return { error: 'Service not found' }
  if (!admin && service.businesses.owner_id !== user.id) return { error: 'Not authorized' }

  const { error } = await db.from('services').delete().eq('id', id)
  if (error) return { error: error.message }

  void refreshBusinessEmbedding(db, service.business_id)
  revalidatePath('/dashboard/services')
  revalidatePath(`/marketplace/${service.business_id}`)
  return { error: null }
}
