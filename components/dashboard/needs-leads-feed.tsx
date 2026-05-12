import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { MapPin, Clock, MessageSquare, ArrowRight, Briefcase, Users } from 'lucide-react'
import { format, differenceInDays, isPast } from 'date-fns'
import type { NeedsPost } from '@/app/(app)/dashboard/page'

interface NeedsLeadsFeedProps {
  businessNeeds: NeedsPost[]
  communityAsks: NeedsPost[]
  country: string | null
}

function PostRow({ post, basePath }: { post: NeedsPost; basePath: string }) {
  const requiredBy = new Date(post.required_by)
  const daysLeft = differenceInDays(requiredBy, new Date())
  const isExpiringSoon = daysLeft >= 0 && daysLeft <= 2
  const isExpired = isPast(requiredBy)
  const location = [post.geography_city, post.geography_country].filter(Boolean).join(', ')

  return (
    <Link
      href={`${basePath}/${post.id}`}
      className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium group-hover:text-primary transition-colors leading-snug truncate">
          {post.title}
        </p>
        <div className="flex items-center gap-2.5 flex-wrap mt-1 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{post.category}</Badge>

          {location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" />{location}
            </span>
          )}

          <span className={cn(
            'flex items-center gap-1',
            isExpiringSoon && 'text-yellow-600 dark:text-yellow-400',
            isExpired && 'line-through',
          )}>
            <Clock className="h-3 w-3 shrink-0" />
            {isExpired
              ? `Expired ${format(requiredBy, 'MMM d')}`
              : daysLeft === 0
                ? 'Due today'
                : `${daysLeft}d left`
            }
          </span>

          {post.response_count > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3 shrink-0" />
              {post.response_count}
            </span>
          )}
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  )
}

export function NeedsLeadsFeed({ businessNeeds, communityAsks, country }: NeedsLeadsFeedProps) {
  const hasAny = businessNeeds.length > 0 || communityAsks.length > 0
  const geoLabel = country ? ` in ${country}` : ''

  return (
    <section className="space-y-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Needs &amp; Leads{geoLabel}
        </h2>
      </div>

      {!hasAny ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No open posts{geoLabel} right now.{' '}
          <Link href="/bulletin" className="text-primary hover:underline">Browse all needs →</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Business Needs column */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Briefcase className="h-4 w-4 text-primary" />
                Business Needs
              </div>
              <Link
                href="/bulletin"
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-xs h-7 px-2 gap-1')}
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {businessNeeds.length > 0 ? (
              <div className="divide-y divide-border">
                {businessNeeds.map(post => (
                  <PostRow key={post.id} post={post} basePath="/bulletin" />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6 px-4">
                No open business needs{geoLabel}.
              </p>
            )}
          </div>

          {/* Community Asks column */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4 text-primary" />
                Community Asks
              </div>
              <Link
                href="/community"
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-xs h-7 px-2 gap-1')}
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {communityAsks.length > 0 ? (
              <div className="divide-y divide-border">
                {communityAsks.map(post => (
                  <PostRow key={post.id} post={post} basePath="/community" />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6 px-4">
                No open community asks{geoLabel}.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
