'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireVerified } from '@/lib/verification-gate'

const EndorsementSchema = z.object({
  business_id: z.string().uuid(),
  text: z.string().trim().max(200).optional(),
})

export async function submitEndorsement(data: {
  business_id: string
  text?: string
}): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const parsed = EndorsementSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Sponsors cannot endorse — per scope F13/hierarchy L2.
  const gate = await requireVerified(db, user.id)
  if (!gate.ok) return { error: gate.reason ?? 'Not allowed' }

  // Prevent self-endorsements (members can't endorse their own business)
  const { data: business } = await db
    .from('businesses')
    .select('owner_id')
    .eq('id', parsed.data.business_id)
    .single() as { data: { owner_id: string } | null }

  if (!business) return { error: 'Business not found' }
  if (business.owner_id === user.id) {
    return { error: "You can't endorse your own business" }
  }

  // Try to insert. UNIQUE constraint on (from_member_id, business_id)
  // means a member can only endorse each business once.
  const { error } = await db.from('endorsements').insert({
    from_member_id: user.id,
    business_id: parsed.data.business_id,
    text: parsed.data.text ?? null,
  }) as { error: { code?: string; message: string } | null }

  if (error) {
    // 23505 = unique_violation — the member already endorsed this business.
    if (error.code === '23505') {
      return { error: "You've already endorsed this business. Contact support if you need to update your endorsement." }
    }
    return { error: error.message }
  }

  revalidatePath(`/marketplace/${parsed.data.business_id}`)
  return { error: null }
}
