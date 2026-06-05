import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { assignMarketTags } from './assign-market-tags'

/**
 * Action-safe wrapper around assignMarketTags.
 * Creates the service-role client internally so server actions
 * don't need to pass an admin DB reference.
 *
 * Designed for fire-and-forget usage:
 *   void assignMarketTagsForBusiness(businessId)
 */
export async function assignMarketTagsForBusiness(businessId: string): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  await assignMarketTags(svc, businessId)
}
