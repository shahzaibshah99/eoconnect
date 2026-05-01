'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Mark all of the current user's notifications as read by bumping
 * profiles.notifications_seen_at to now().
 *
 * Called when the user opens the notifications dropdown OR clicks
 * "Mark all as read". Idempotent — calling it twice in quick
 * succession just re-stamps the same column.
 *
 * Does not return an error when the call fails — notifications
 * read state is best-effort. The next page render will recompute
 * the count regardless.
 */
export async function markNotificationsRead(): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { error } = await db
    .from('profiles')
    .update({ notifications_seen_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) return { error: error.message }

  // The navbar's notification count is rendered server-side via the
  // (app) layout; revalidating it forces a fresh render with the
  // updated seen-at timestamp.
  revalidatePath('/', 'layout')
  return { error: null }
}
