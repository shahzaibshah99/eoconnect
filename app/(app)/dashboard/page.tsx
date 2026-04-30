import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Eye, Search, MessageCircle, LayoutList, Inbox, Megaphone, UserCog, Building2, Layers, Plus, MessageSquare } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ADS_ENABLED } from '@/lib/feature-flags'
import { StatsCard } from '@/components/dashboard/stats-card'
import { AnalyticsChart } from '@/components/dashboard/analytics-chart'
import { LeadProgress } from '@/components/dashboard/lead-progress'
import { DashboardViewToggle } from '@/components/dashboard/dashboard-view-toggle'
import { CustomerView } from '@/components/dashboard/customer-view'
import { BusinessSwitcher } from '@/components/dashboard/business-switcher'

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

  // Fetch ALL the user's businesses for the switcher dropdown.
  const { data: ownedBusinesses } = await db
    .from('businesses')
    .select('id, name, status')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false }) as {
      data: Array<{ id: string; name: string; status: string }> | null
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
        <CustomerView conversations={customerConversations} />
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-bold mb-2">Set up your business profile</h2>
          <p className="text-muted-foreground mb-6">Create your listing to appear in the Member Market marketplace.</p>
          <Link
            href="/dashboard/business/new"
            className={cn(buttonVariants(), 'bg-primary text-primary-foreground font-bold')}
          >
            Create Profile
          </Link>
        </div>
      </div>
    )
  }

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

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
        <Badge variant="secondary" className="capitalize ml-auto">{business.status}</Badge>
      </div>

      {/* Profile / business management actions (MM-11, MM-12) */}
      <div className="flex flex-wrap gap-2">
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
    <DashboardViewToggle
      providerContent={providerView}
      customerContent={<CustomerView conversations={customerConversations} />}
    />
  )
}
