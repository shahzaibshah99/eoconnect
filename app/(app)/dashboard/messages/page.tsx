import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { ConversationList } from '@/components/messages/conversation-list'
import { MessageThread } from '@/components/messages/message-thread'
import { Inbox } from 'lucide-react'

/**
 * Service-role client for marking messages as read.
 *
 * Why: the messages table only had SELECT + INSERT RLS policies until
 * migration 011 added an UPDATE policy. Until that migration runs in
 * production, the user-scoped client silently fails (zero rows affected,
 * no error) and the unread badge in the navbar persists across refreshes.
 *
 * Using the service-role client server-side bypasses RLS for this admin-style
 * operation (we still constrain the WHERE clause to the active user's
 * conversations and to messages they didn't send themselves, so this isn't
 * giving anyone elevated read access).
 */
function markReadDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

interface MessagesPageProps {
  searchParams: Promise<{ conversation?: string }>
}

export default async function MessagesPage({ searchParams }: MessagesPageProps) {
  const { conversation: activeId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: conversations } = await db
    .from('conversations')
    .select('id, participant_ids, listing_id, service_id, last_message_at, created_at')
    .contains('participant_ids', [user.id])
    .order('last_message_at', { ascending: false })

  const convList = (conversations ?? []) as Array<{
    id: string
    participant_ids: string[]
    listing_id: string | null
    service_id: string | null
    last_message_at: string
    created_at: string
  }>

  const otherIds = [...new Set(convList.flatMap(c => c.participant_ids).filter(id => id !== user.id))]
  const businessIds = [...new Set(convList.map(c => c.listing_id).filter((x): x is string => !!x))]
  const serviceIds = [...new Set(convList.map(c => c.service_id).filter((x): x is string => !!x))]

  // Pull profile metadata richly enough to populate the new business-
  // first row layout: avatar (fallback if business has no logo), name,
  // EO chapter, and membership type for the secondary line. Owner_id
  // on the business tells us whether the current user is the buyer or
  // the seller in each thread (drives the You inquired / They inquired
  // pill).
  const [{ data: profiles }, { data: businesses }, { data: services }, { data: lastMsgs }] = await Promise.all([
    otherIds.length
      ? db.from('profiles').select('id, full_name, avatar_url, eo_chapter, eo_membership_type').in('id', otherIds)
      : Promise.resolve({ data: [] }),
    businessIds.length
      ? db.from('businesses').select('id, name, logo_url, owner_id').in('id', businessIds)
      : Promise.resolve({ data: [] }),
    serviceIds.length
      ? db.from('services').select('id, title').in('id', serviceIds)
      : Promise.resolve({ data: [] }),
    convList.length
      ? db.from('messages').select('conversation_id, body, created_at, read_at, sender_id')
          .in('conversation_id', convList.map(c => c.id))
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  type ProfileRow = {
    id: string; full_name: string; avatar_url: string | null;
    eo_chapter: string | null; eo_membership_type: 'current_member' | 'alumni' | 'accelerator' | null
  }
  type BusinessRow = { id: string; name: string; logo_url: string | null; owner_id: string }
  type ServiceRow = { id: string; title: string }
  const profileMap = new Map<string, ProfileRow>((profiles ?? []).map((p: ProfileRow) => [p.id, p]))
  const bizMap = new Map<string, BusinessRow>((businesses ?? []).map((b: BusinessRow) => [b.id, b]))
  const serviceMap = new Map<string, ServiceRow>((services ?? []).map((s: ServiceRow) => [s.id, s]))
  const lastMsgMap = new Map<string, { body: string; created_at: string; read_at: string | null; sender_id: string }>()
  for (const m of (lastMsgs ?? [])) {
    if (!lastMsgMap.has(m.conversation_id)) lastMsgMap.set(m.conversation_id, m)
  }

  const enriched = convList.map(c => {
    const otherId = c.participant_ids.find(id => id !== user.id)
    const otherProfile = otherId ? profileMap.get(otherId) : undefined
    const business = c.listing_id ? bizMap.get(c.listing_id) : undefined
    const service = c.service_id ? serviceMap.get(c.service_id) : undefined
    const lastMsg = lastMsgMap.get(c.id)
    // Buyer vs seller is derived from listing ownership: the listing
    // owner is the seller, anyone else in the thread is the buyer
    // ("inquired"). When the listing was deleted (no business row),
    // we default to "you inquired" if the current user wasn't the
    // original owner — but we only know that when the listing exists.
    // For deleted listings the role pill is suppressed entirely (see
    // ConversationList).
    const isCurrentUserOwner = !!business && business.owner_id === user.id
    return {
      id: c.id,
      otherName: otherProfile?.full_name ?? 'Unknown',
      otherAvatar: otherProfile?.avatar_url ?? null,
      otherChapter: otherProfile?.eo_chapter ?? null,
      otherMembershipType: otherProfile?.eo_membership_type ?? null,
      businessId: business?.id ?? null,
      businessName: business?.name ?? null,
      businessLogo: business?.logo_url ?? null,
      businessDeleted: c.listing_id !== null && !business,
      serviceTitle: service?.title ?? null,
      role: business ? (isCurrentUserOwner ? 'seller' as const : 'buyer' as const) : null,
      lastMessageBody: lastMsg?.body ?? null,
      lastMessageAt: c.last_message_at,
      unread: lastMsg ? lastMsg.sender_id !== user.id && !lastMsg.read_at : false,
    }
  })

  // Active conversation
  let activeMessages: Array<{
    id: string
    sender_id: string
    body: string
    created_at: string
    attachment_url: string | null
    attachment_name: string | null
    attachment_mime: string | null
    attachment_size: number | null
  }> = []
  let activeMeta: typeof enriched[0] | null = null
  if (activeId && convList.find(c => c.id === activeId)) {
    activeMeta = enriched.find(c => c.id === activeId) ?? null
    const { data: msgs } = await db
      .from('messages')
      .select('id, sender_id, body, created_at, attachment_url, attachment_name, attachment_mime, attachment_size')
      .eq('conversation_id', activeId)
      .order('created_at', { ascending: true })
    activeMessages = (msgs ?? []) as typeof activeMessages

    // Mark as read using the service-role client so it works regardless of
    // whether migration 011 (the messages UPDATE policy) has been applied.
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { error: markErr, count } = await markReadDb()
        .from('messages')
        .update({ read_at: new Date().toISOString() }, { count: 'exact' })
        .eq('conversation_id', activeId)
        .neq('sender_id', user.id)
        .is('read_at', null)
      if (markErr) console.error('[messages] mark-as-read failed:', markErr)
      else if ((count ?? 0) > 0) console.log(`[messages] marked ${count} messages read in ${activeId}`)
    } else {
      // Fallback to user-scoped update if service role isn't configured.
      // This is the original path; works only after migration 011.
      await db.from('messages').update({ read_at: new Date().toISOString() })
        .eq('conversation_id', activeId).neq('sender_id', user.id).is('read_at', null)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-12rem)]">
      <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="font-bold text-lg">Messages</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{enriched.length} conversation{enriched.length !== 1 ? 's' : ''}</p>
        </div>
        <ConversationList conversations={enriched} activeId={activeId ?? null} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
        {activeId && activeMeta ? (
          <MessageThread
            conversationId={activeId}
            currentUserId={user.id}
            otherName={activeMeta.otherName}
            otherAvatar={activeMeta.otherAvatar}
            businessName={activeMeta.businessName}
            businessId={activeMeta.businessId}
            businessLogo={activeMeta.businessLogo}
            serviceTitle={activeMeta.serviceTitle}
            role={activeMeta.role}
            initialMessages={activeMessages}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="font-semibold">Select a conversation</p>
            <p className="text-sm text-muted-foreground mt-1">
              {enriched.length === 0
                ? 'Start by browsing the marketplace and sending an inquiry.'
                : 'Pick a conversation from the list to start chatting.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
