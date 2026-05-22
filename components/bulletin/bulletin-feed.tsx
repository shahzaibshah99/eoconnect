'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { PostCard } from '@/components/bulletin/post-card'
import { Search, Briefcase, Users, Plus } from 'lucide-react'
import type { PostCardItem } from '@/components/bulletin/post-card'

interface FeedPost extends PostCardItem {
  board_type: 'business' | 'community'
}

interface BulletinFeedProps {
  posts: FeedPost[]
  isLoggedIn: boolean
}

export function BulletinFeed({ posts, isLoggedIn }: BulletinFeedProps) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'business' | 'community'>('all')

  const businessCount = posts.filter(p => p.board_type === 'business').length
  const communityCount = posts.filter(p => p.board_type === 'community').length

  const filtered = posts.filter(p => {
    if (typeFilter !== 'all' && p.board_type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        p.title.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.detail?.toLowerCase().includes(q) ||
        p.tags?.some(t => t.toLowerCase().includes(q))
      )
    }
    return true
  })

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Needs &amp; Asks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Business needs and community asks from members. Reply if you can help.
          </p>
        </div>
        {isLoggedIn && (
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/bulletin/new"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
            >
              <Briefcase className="h-3.5 w-3.5" /> Business Need
            </Link>
            <Link
              href="/community/new"
              className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5 bg-primary text-primary-foreground font-bold')}
            >
              <Plus className="h-3.5 w-3.5" /> Community Ask
            </Link>
          </div>
        )}
      </div>

      {/* Search + type filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            placeholder="Search by title, category, tags…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-8 pr-3 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
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

      {/* Results */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(post => (
            <PostCard
              key={post.id}
              post={post}
              basePath={post.board_type === 'community' ? '/community' : '/bulletin'}
              showTypeBadge
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <p className="text-2xl mb-3">{search ? '🔍' : '📋'}</p>
          <p className="font-semibold">
            {search ? 'No posts match your search' : 'No open posts yet'}
          </p>
          {!search && (
            <p className="text-sm text-muted-foreground mt-1">
              Be the first to post what you&apos;re looking for.
            </p>
          )}
          {!search && isLoggedIn && (
            <Link href="/bulletin/new" className={cn(buttonVariants(), 'mt-4 gap-1.5')}>
              <Plus className="h-4 w-4" /> Post a Need
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
