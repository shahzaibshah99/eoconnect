'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { CURRENT_TERMS_VERSION } from '@/lib/terms-constants'

/**
 * Stamp the current user's profile with the acceptance timestamp and
 * version. Called from the /terms-accept page after the member clicks
 * "I Agree". Cannot be called on behalf of another user.
 */
export async function acceptTerms(): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { error } = await db
    .from('profiles')
    .update({
      terms_accepted_at: new Date().toISOString(),
      terms_version: CURRENT_TERMS_VERSION,
    })
    .eq('id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
  return { error: null }
}
