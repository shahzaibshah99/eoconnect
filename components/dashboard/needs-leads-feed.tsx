'use client'

import { useState } from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { MapPin, Clock, MessageSquare, ArrowRight, Search, Briefcase, Users } from 'lucide-react'
import { format, differenceInDays, isPast } from 'date-fns'
import type { NeedsPost } from '@/app/(app)/dashboard/page'

interface NeedsLeadsFeedProps {
  posts: NeedsPost[]
  country: string | null
}

export function NeedsLeadsFeed({ posts, country }: NeedsLeadsFeedProps) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'business' | 'community'>('all')

  const geoLabel = country ? ` in ${country}` : ''

  const filtered = posts.filter(p => {
    if (typeFilter !== 'all' && p.board_type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return p.title.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    }
    return true
  })

  const businessCount = posts.filter(p => p.board_type === 'business').length
  const communityCount = posts.filter(p => p.board_type === 'community').length

  return (
    <section className="space-y-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Needs &amp; Asks{geoLabel}
        </h2>
        <Link
          href="/bulletin/new"
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-xs h-7 px-2')}
        >
          + Post
        </Link>
      </div>

      {/* Search + type filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            placeholder="Search needs and asks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 rounded-lg bg-muted/50 border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setTypeFilter('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium',
              typeFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            )}
          >
            All ({posts.length})
          </button>
          <button
            onClick={() => setTypeFilter('business')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1',
              typeFilter === 'business' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            )}
          >
            <Briefcase className="h-3 w-3" /> Business ({businessCount})
          </button>
          <button
            onClick={() => setTypeFilter('community')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1',
              typeFilter === 'community' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            )}
          >
            <Users className="h-3 w-3" /> Community ({communityCount})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {search || typeFilter !== 'all'
            ? 'No posts match your filter.'
            : <>No open posts{geoLabel} right now.{' '}
                <Link href="/bulletin" className="text-primary hover:underline">Browse all →</Link>
              </>
          }
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.slice(0, 10).map(post => (
              <PostRow key={post.id} post={post} />
            ))}
          </div>
          {filtered.length > 10 && (
            <div className="p-3 border-t border-border text-center">
              <Link href="/bulletin" className="text-xs text-primary hover:underline">
                View all {filtered.length} posts →
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function PostRow({ post }: { post: NeedsPost }) {
  const basePath = post.board_type === 'community' ? '/community' : '/bulletin'
  const requiredBy = new Date(post.required_by)
  const daysLeft = differenceInDays(requiredBy, new Date())
  const isExpiringSoon = daysLeft >= 0 && daysLeft <= 2
  const isExpired = isPast(requiredBy)
  const location = [post.geography_city, post.geography_country].filter(Boolean).join(', ')

  return (
    <Link
      href={`${basePath}/${post.id}`}
      className="flex items-start gap-3 p-3 hover:bg-muted/50 transition-colors group"
    >
      <div className="mt-0.5 shrink-0">
        {post.board_type === 'community'
          ? <Users className="h-3.5 w-3.5 text-blue-500" />
          : <Briefcase className="h-3.5 w-3.5 text-primary" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium group-hover:text-primary transition-colors leading-snug">
          {post.title}
        </p>
        {post.ai_tagline && post.board_type === 'community' && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 italic">{post.ai_tagline}</p>
        )}
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
