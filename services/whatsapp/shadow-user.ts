import 'server-only'
import { createClient } from '@supabase/supabase-js'

export interface ShadowUserRow {
  id: string
  whatsapp_jid: string
  whatsapp_display_name: string | null
  linked_user_id: string | null
  // The profiles.id (auth user UUID) for this shadow user — used as bulletin_posts.member_id
  profile_id: string
}

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function getOrCreateShadowUser(
  jid: string,
  displayName: string,
  groupJid?: string
): Promise<ShadowUserRow | null> {
  const db = adminDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any

  // Deterministic email for the shadow auth user — lets us recover the
  // profile id without scanning all users.
  const shadowEmail = `wa-${jid.replace(/[^a-z0-9]/gi, '-').toLowerCase()}@shadow.internal`

  try {
    // Check if we already have a shadow_users record for this JID
    const { data: existing } = await dbAny
      .from('shadow_users')
      .select('id, whatsapp_jid, whatsapp_display_name, linked_user_id')
      .eq('whatsapp_jid', jid)
      .maybeSingle() as { data: Omit<ShadowUserRow, 'profile_id'> | null }

    if (existing) {
      // Recover the shadow profile id. Prefer the linked real profile; otherwise
      // look up the shadow profile by its deterministic email.
      let profileId = existing.linked_user_id
      if (!profileId) {
        const { data: prof } = await dbAny
          .from('profiles')
          .select('id')
          .eq('eo_membership_email', shadowEmail)
          .maybeSingle() as { data: { id: string } | null }
        profileId = prof?.id ?? null
      }
      if (!profileId) {
        console.error('[shadow-user] existing shadow_users row but no profile found for', jid)
        return null
      }
      return { ...existing, profile_id: profileId }
    }

    // profiles.id has a FK to auth.users(id). Creating the auth user fires the
    // on_auth_user_created trigger (migration 001) which AUTO-CREATES the
    // profiles row — so we must UPDATE that row, not insert a second one.
    const { data: authUser, error: authErr } = await db.auth.admin.createUser({
      email: shadowEmail,
      email_confirm: true,
      user_metadata: { is_shadow: true, whatsapp_jid: jid, full_name: displayName || `WA-${jid.split('@')[0]}` },
    })

    let profileId: string | null = authUser?.user?.id ?? null

    if (authErr || !profileId) {
      // The auth user may already exist from a prior run (WAHA retry, partial
      // failure where the shadow_users row never got written, etc.). Recover its
      // id from the profile created by the on_auth_user_created trigger, which
      // sets eo_membership_email = the auth email.
      const alreadyExists = /already.*registered|already.*been registered|already exists/i.test(authErr?.message ?? '')
      if (alreadyExists) {
        const { data: prof } = await dbAny
          .from('profiles')
          .select('id')
          .eq('eo_membership_email', shadowEmail)
          .maybeSingle() as { data: { id: string } | null }
        profileId = prof?.id ?? null
      }
      if (!profileId) {
        console.error('[shadow-user] createUser failed and could not recover existing user:', authErr?.message)
        return null
      }
    }

    // Mark the (new or pre-existing) profile as a shadow account.
    const { error: profileErr } = await dbAny
      .from('profiles')
      .update({
        full_name: displayName || `WA-${jid.split('@')[0]}`,
        status: 'active',
        is_shadow: true,
      })
      .eq('id', profileId)

    if (profileErr) {
      console.error('[shadow-user] profiles update failed:', profileErr.message)
      return null
    }

    // Upsert the shadow_users record so re-runs don't fail on the unique JID.
    const { data: shadowUser, error: shadowErr } = await dbAny
      .from('shadow_users')
      .upsert(
        {
          whatsapp_jid: jid,
          whatsapp_display_name: displayName || null,
          source_group_jid: groupJid || null,
          notify_via_whatsapp: true,
        },
        { onConflict: 'whatsapp_jid' }
      )
      .select('id, whatsapp_jid, whatsapp_display_name, linked_user_id')
      .maybeSingle() as { data: Omit<ShadowUserRow, 'profile_id'> | null; error: { message: string } | null }

    if (shadowErr || !shadowUser) {
      console.error('[shadow-user] shadow_users upsert failed:', shadowErr?.message)
      return null
    }

    return { ...shadowUser, profile_id: profileId }
  } catch (err) {
    console.error('[shadow-user] unexpected error:', err)
    return null
  }
}
