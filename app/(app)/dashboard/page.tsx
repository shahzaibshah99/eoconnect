import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Eye, Search, MessageCircle, LayoutList, Inbox, Megaphone, UserCog, Building2, Layers, Plus, MessageSquare, ExternalLink, Handshake } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ADS_ENABLED } from '@/lib/feature-flags'
import { StatsCard } from '@/components/dashboard/stats-card'
import { AnalyticsChart } from '@/components/dashboard/analytics-chart'
import { LeadProgress } from '@/components/dashboard/lead-progress'
import { DashboardViewToggle } from '@/components/dashboard/dashboard-view-toggle'
import { CustomerView } from '@/components/dashboard/customer-view'
import { BusinessSwitcher } from '@/components/dashboard/business-switcher'
import { NeedsLeadsFeed } from '@/components/dashboard/needs-leads-feed'
import { QuickPostDialog } from '@/components/dashboard/quick-post-dialog'

export type NeedsPost = {
  id: string
  title: string
  category: string
  tags: string[]
  geography_country: string | null
  geography_city: string | null
  required_by: string
  status: 'open' | 'fulfilled' | 'expired' | 'archived'
  response_count: number
  created_at: string
  board_type: 'business' | 'community'
  ai_tagline: string | null
}

interface DashboardPageProps {
  searchParams: Promise<{ business?: string }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Fetch verification state — drives the "Verify to unlock" banner
  // shown above all dashboard content for unverified members. Per
  // marketing-lead rule: unverified members can't list/post/message.
  const { data: profileTag } = await db
    .from('profiles')
    .select('verification_tag')
    .eq('id', user.id)
    .maybeSingle() as { data: { verification_tag: string } | null }
  const isUnverified = profileTag?.verification_tag === 'unverified'

  // Fetch ALL the user's businesses for the switcher dropdown.
  const { data: ownedBusinesses } = await db
    .from('businesses')
    .select('id, name, status, country, created_at, slow_replier')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false }) as {
      data: Array<{ id: string; name: string; status: string; country: string | null; created_at: string | null; slow_replier: boolean }> | null
    }
  const allBusinesses = ownedBusinesses ?? []
  // Pick the business named in ?business=<id> if it belongs to this user,
  // otherwise default to the most recent one.
  const business =
    (params.business && allBusinesses.find(b => b.id === params.business))
    ?? allBusinesses[0]
    ?? null

  // Fetch conversations where user is a participant. We pull the listing
  // owner_id alongside the name so we can split conversations into:
  //   - customer-side  → user is NOT the owner (they sent the inquiry)
  //   - provider-side  → user IS the owner (incoming inquiry on their listing)
  // Without this split, every conversation lands in "As a customer" — even
  // ones where the user is actually responding to inquiries on their own
  // business, which was confusing.
  const { data: conversations } = await db
    .from('conversations')
    .select('id, listing_id, last_message_at')
    .contains('participant_ids', [user.id])
    .order('last_message_at', { ascending: false })
    .limit(20) as { data: Array<{ id: string; listing_id: string | null; last_message_at: string }> | null }

  const conversationsWithNames = await Promise.all(
    (conversations ?? []).map(async (conv) => {
      if (!conv.listing_id) {
        return { ...conv, businessName: undefined as string | undefined, ownerId: null as string | null }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: biz } = await (db as any)
        .from('businesses')
        .select('name, owner_id')
        .eq('id', conv.listing_id)
        .maybeSingle() as { data: { name: string; owner_id: string } | null }
      return { ...conv, businessName: biz?.name, ownerId: biz?.owner_id ?? null }
    })
  )

  // Split by user's role in each conversation. Provider bucket = listings
  // they own; customer bucket = inquiries they sent on listings they don't own.
  //
  // Orphaned conversations (listing_id IS NULL because the business was
  // deleted) end up with ownerId === null. We exclude them from BOTH buckets
  // rather than letting them fall into "customer" by default — without the
  // listing we can't tell which side the user was on, and showing past
  // inbound inquiries on a deleted listing under "As a customer" misled
  // providers into thinking *they* had sent those messages.
  const providerConversations = conversationsWithNames.filter(c => c.ownerId === user.id)
  const customerConversations = conversationsWithNames.filter(
    c => c.ownerId !== null && c.ownerId !== user.id
  )

  if (!business) {
    // No business yet — user is purely on the customer side. Their
    // outbound inquiries are the only conversations to show.
    return (
      <div className="space-y-6">
        {isUnverified && <UnverifiedBanner />}
        <CustomerView conversations={customerConversations} />
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-bold mb-2">Set up your business profile</h2>
          <p className="text-muted-foreground mb-6">
            {isUnverified
              ? 'Verify your membership first, then create your listing to appear in the marketplace.'
              : 'Create your listing to appear in the Member Market marketplace.'}
          </p>
          <Link
            href={isUnverified ? '/dashboard/verify' : '/dashboard/business/new'}
            className={cn(buttonVariants(), 'bg-primary text-primary-foreground font-bold')}
          >
            {isUnverified ? 'Verify Membership' : 'Create Profile'}
          </Link>
        </div>
      </div>
    )
  }

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Needs & Leads feed — open posts geo-matched to the member's business country.
  // We fetch both board types in a single query and split client-side.
  // Falls back to showing all open posts when the business has no country set.
  const needsQuery = db
    .from('bulletin_posts')
    .select('id, title, category, tags, geography_country, geography_city, required_by, status, response_count, created_at, board_type, ai_tagline')
    .eq('status', 'open')
    .eq('tenant_id', 'eo')
    .order('created_at', { ascending: false })
    .limit(20)

  const { data: needsPosts } = business?.country
    ? await needsQuery.eq('geography_country', business.country)
    : await needsQuery

  const allNeedsPosts = (needsPosts ?? []) as NeedsPost[]

  // Endorsements received on ALL the member's businesses
  const allBusinessIds = allBusinesses.map(b => b.id)
  const { data: endorsementsReceived } = allBusinessIds.length > 0
    ? await db
        .from('endorsements')
        .select('id, text, created_at, business_id, profiles!from_member_id(full_name, avatar_url)')
        .in('business_id', allBusinessIds)
        .order('created_at', { ascending: false })
        .limit(5) as {
          data: Array<{
            id: string
            text: string | null
            created_at: string
            business_id: string
            profiles?: { full_name?: string | null; avatar_url?: string | null } | null
          }> | null
        }
    : { data: null }

  // My Posts — member's own bulletin posts (both board types), most recent first
  const { data: myPosts } = await db
    .from('bulletin_posts')
    .select('id, title, status, board_type, response_count, required_by, created_at')
    .eq('member_id', user.id)
    .eq('tenant_id', 'eo')
    .order('created_at', { ascending: false })
    .limit(5) as {
    data: Array<{
      id: string
      title: string
      status: 'open' | 'fulfilled' | 'expired' | 'archived'
      board_type: 'business' | 'community'
      response_count: number
      required_by: string
      created_at: string
    }> | null
  }

  const { data: analytics } = await db
    .from('listing_analytics')
    .select('date, views, search_appearances, contact_clicks')
    .eq('business_id', business.id)
    .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('date', { ascending: true }) as { data: Array<{ date: string; views: number; search_appearances: number; contact_clicks: number }> | null }

  const totalViews = analytics?.reduce((sum, r) => sum + (r.views ?? 0), 0) ?? 0
  const totalSearchAppearances = analytics?.reduce((sum, r) => sum + (r.search_appearances ?? 0), 0) ?? 0
  const totalContactClicks = analytics?.reduce((sum, r) => sum + (r.contact_clicks ?? 0), 0) ?? 0

  const chartData = (analytics ?? []).map((r) => ({
    date: r.date,
    views: r.views ?? 0,
    contact_clicks: r.contact_clicks ?? 0,
  }))

  const providerView = (
    <div className="space-y-8">
      {/* Header — name + switcher dropdown when multiple businesses exist */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          {allBusinesses.length > 1 ? (
            <BusinessSwitcher
              businesses={allBusinesses}
              currentId={business.id}
            />
          ) : (
            <h1 className="text-2xl font-bold">{business.name}</h1>
          )}
          <p className="text-muted-foreground text-sm mt-0.5">Business Dashboard</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {/* Freshness indicator — green (<60d), amber (60-89d), grey+label (90d+/slow replier) */}
          {(() => {
            if (business.slow_replier) {
              return <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />Slow replier</span>
            }
            const daysSinceCreated = Math.floor((Date.now() - new Date(business.created_at ?? Date.now()).getTime()) / (24 * 60 * 60 * 1000))
            if (daysSinceCreated >= 60) {
              return <span className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400"><span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" />Low activity</span>
            }
            return <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400"><span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />Active</span>
          })()}
          <Badge variant="secondary" className="capitalize">{business.status}</Badge>
        </div>
        <QuickPostDialog />
      </div>

      {/* Profile / business management actions (MM-11, MM-12) */}
      <div className="flex flex-wrap gap-2">
        {/* View Listing — opens in a new tab so the dashboard
            stays put behind it. The user reported having no way
            to see their own listing from the dashboard; this is
            the primary affordance for that. */}
        <Link
          href={`/marketplace/${business.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
        >
          <ExternalLink className="h-4 w-4" /> View My Listing
        </Link>
        <Link
          href="/dashboard/account"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
        >
          <UserCog className="h-4 w-4" /> Edit Profile
        </Link>
        <Link
          href={`/dashboard/business/edit/${business.id}`}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
        >
          <Building2 className="h-4 w-4" /> Edit This Business
        </Link>
        <Link
          href="/dashboard/business/edit"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
        >
          <Layers className="h-4 w-4" /> All My Businesses
        </Link>
        <Link
          href="/dashboard/business/new"
          className={cn(buttonVariants({ size: 'sm' }), 'bg-primary text-primary-foreground font-bold gap-1.5')}
        >
          <Plus className="h-4 w-4" /> Add Another Business
        </Link>
      </div>

      {/* MM-10: Manage Services + Messages promoted above analytics */}
      <div className={`grid grid-cols-1 ${ADS_ENABLED ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4`}>
        <Link href="/dashboard/services" className="block p-6 bg-card border border-border rounded-xl hover:border-primary transition-colors">
          <LayoutList className="w-5 h-5 text-primary mb-3" />
          <p className="text-sm text-muted-foreground">Manage</p>
          <p className="text-xl font-bold mt-0.5">Services</p>
        </Link>
        <Link href="/dashboard/messages" className="block p-6 bg-card border border-border rounded-xl hover:border-primary transition-colors">
          <Inbox className="w-5 h-5 text-primary mb-3" />
          <p className="text-sm text-muted-foreground">Check</p>
          <p className="text-xl font-bold mt-0.5">Messages</p>
        </Link>
        {ADS_ENABLED && (
          <Link href="/dashboard/ads" className="block p-6 bg-card border border-border rounded-xl hover:border-primary transition-colors">
            <Megaphone className="w-5 h-5 text-primary mb-3" />
            <p className="text-sm text-muted-foreground">Ad Campaigns</p>
            <p className="text-xl font-bold mt-0.5">Promote</p>
          </Link>
        )}
      </div>

      {/* Inquiries received — conversations on listings the user owns.
          Previously these dumped into the "As a customer" tab regardless,
          which made no sense for the provider. */}
      {providerConversations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Recent Inquiries</h2>
          <div className="flex flex-col gap-3">
            {providerConversations.slice(0, 5).map(conv => (
              <div
                key={conv.id}
                className="flex items-center justify-between gap-4 bg-card border border-border rounded-xl p-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <MessageSquare className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{conv.businessName ?? 'Your listing'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <Link
                  href={`/dashboard/messages?conversation=${conv.id}`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
                >
                  Reply
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My Listings — all businesses with freshness indicators */}
      <section className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">My Listings</h2>
          <Link href="/dashboard/business/edit" className="text-xs text-primary hover:underline">Manage all →</Link>
        </div>
        <div className="space-y-2">
          {allBusinesses.map(b => {
            const daysSince = Math.floor((Date.now() - new Date(b.created_at ?? Date.now()).getTime()) / (24 * 60 * 60 * 1000))
            const freshness = b.slow_replier
              ? { dot: 'bg-muted-foreground/40', label: 'Slow replier', color: 'text-muted-foreground' }
              : daysSince >= 60
                ? { dot: 'bg-yellow-500', label: 'Low activity', color: 'text-yellow-600 dark:text-yellow-400' }
                : { dot: 'bg-green-500', label: 'Active', color: 'text-green-600 dark:text-green-400' }
            return (
              <div key={b.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{b.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`flex items-center gap-1 text-[11px] ${freshness.color}`}>
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${freshness.dot}`} />
                      {freshness.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground capitalize">· {b.status}</span>
                  </div>
                </div>
                <Link href={`/marketplace/${b.id}`} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-primary hover:underline shrink-0">
                  View →
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      {/* Needs & Leads feed — moved above My Posts (defect #6 fix) */}
      <NeedsLeadsFeed
        posts={allNeedsPosts}
        country={business.country ?? null}
      />

      {/* My Posts — member's own bulletin board posts */}
      {myPosts && myPosts.length > 0 && (
        <section className="space-y-3 pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">My Posts</h2>
            <Link href="/bulletin" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          <div className="space-y-2">
            {myPosts.map(p => {
              const href = p.board_type === 'community' ? `/community/${p.id}` : `/bulletin/${p.id}`
              const statusColor = p.status === 'fulfilled'
                ? 'text-green-600 dark:text-green-400'
                : p.status === 'open'
                  ? 'text-primary'
                  : 'text-muted-foreground'
              return (
                <Link key={p.id} href={href} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{p.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                      <span className={`capitalize font-medium ${statusColor}`}>{p.status}</span>
                      <span>·</span>
                      <span>{p.board_type === 'community' ? 'Community Ask' : 'Business Need'}</span>
                      {p.response_count > 0 && (
                        <><span>·</span><span>{p.response_count} {p.response_count === 1 ? 'reply' : 'replies'}</span></>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Endorsements Received */}
      {endorsementsReceived && endorsementsReceived.length > 0 && (
        <section className="space-y-3 pt-4 border-t border-border">
          <div className="flex items-center gap-2">
            <Handshake className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Endorsements Received ({endorsementsReceived.length})
            </h2>
          </div>
          <div className="space-y-2">
            {endorsementsReceived.map(e => {
              const bizName = allBusinesses.find(b => b.id === e.business_id)?.name
              return (
                <div key={e.id} className="p-3 rounded-lg bg-card border border-border text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{e.profiles?.full_name ?? 'A member'}</span>
                    {bizName && <span className="text-muted-foreground text-xs">endorsed {bizName}</span>}
                  </div>
                  {e.text && <p className="text-muted-foreground mt-1 text-xs">&ldquo;{e.text}&rdquo;</p>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Analytics — secondary, below the fold */}
      <section className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Analytics · last 30 days
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatsCard label="Views" value={totalViews} icon={<Eye className="w-5 h-5" />} />
          <StatsCard label="Search Appearances" value={totalSearchAppearances} icon={<Search className="w-5 h-5" />} />
          <StatsCard label="Inquiries" value={totalContactClicks} icon={<MessageCircle className="w-5 h-5" />} />
        </div>
        <AnalyticsChart data={chartData} />
        <LeadProgress views={totalViews} contactClicks={totalContactClicks} />
      </section>
    </div>
  )

  return (
    <div className="space-y-6">
      {isUnverified && <UnverifiedBanner />}
      <DashboardViewToggle
        providerContent={providerView}
        customerContent={<CustomerView conversations={customerConversations} />}
      />
    </div>
  )
}

/**
 * Top-of-dashboard alert shown to members whose verification_tag is
 * still 'unverified'. Per marketing-lead rule: until verified, members
 * can't list businesses, post, or message — banner makes the gate
 * obvious instead of letting them hit a server-side rejection later.
 */
function UnverifiedBanner() {
  return (
    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-yellow-900 dark:text-yellow-200">
          Your membership isn&apos;t verified yet
        </p>
        <p className="text-xs text-yellow-800/80 dark:text-yellow-200/80 mt-0.5">
          Verify to unlock listing creation, posting, and messaging.
        </p>
      </div>
      <Link
        href="/dashboard/verify"
        className={cn(buttonVariants({ size: 'sm' }), 'bg-yellow-600 hover:bg-yellow-700 text-white font-semibold shrink-0')}
      >
        Verify membership
      </Link>
    </div>
  )
}
