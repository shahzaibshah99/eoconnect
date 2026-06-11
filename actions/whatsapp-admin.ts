'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

export async function toggleWhatsappAgent(enabled: boolean): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null }

  if (profile?.role !== 'super_admin') return { error: 'Forbidden' }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: 'Server misconfigured' }

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svcAny = svc as any

  const { error } = await svcAny
    .from('feature_flags')
    .update({ is_enabled: enabled })
    .eq('flag_name', 'whatsapp_agent_enabled')

  if (error) return { error: error.message }

  revalidatePath('/admin/whatsapp')
  return { error: null }
}
