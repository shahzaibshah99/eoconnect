import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow, format, isPast, differenceInDays } from 'date-fns'
import { MapPin, MessageSquare, Clock, CheckCircle2, Briefcase, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PostCardItem {
  id: string
  title: string
  detail: string | null
  category: string
  tags: string[]
  geography_country: string | null
  geography_city: string | null
  required_by: string
  status: 'open' | 'fulfilled' | 'expired' | 'archived'
  response_count: number
  created_at: string
  board_type?: 'business' | 'community'
  profiles: {
    full_name: string | null
    avatar_url: string | null
    eo_chapter: string | null
    verification_tag: string | null
  } | null
}

interface PostCardProps {
  post: PostCardItem
  currentUserId?: string | null
  basePath?: string
  showTypeBadge?: boolean
}

export function PostCard({ post, currentUserId: _, basePath = '/bulletin', showTypeBadge = false }: PostCardProps) {
  const requiredBy = new Date(post.required_by)
  const daysLeft = differenceInDays(requiredBy, new Date())
  const isExpiringSoon = daysLeft >= 0 && daysLeft <= 2
  const isExpired = isPast(requiredBy)
  const location = [post.geography_city, post.geography_country].filter(Boolean).join(', ')

  return (
    <Link href={`${basePath}/${post.id}`} className="block group">
      <div className={cn(
        'bg-card border border-border rounded-xl p-5 hover:border-primary transition-colors',
        post.status === 'fulfilled' && 'opacity-70',
      )}>
        <div className="flex items-start gap-3">
          <Avatar className="h-9 w-9 shrink-0 mt-0.5">
            <AvatarImage src={post.profiles?.avatar_url ?? undefined} />
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
              {(post.profiles?.full_name ?? '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap mb-1">
              <span className="text-xs text-muted-foreground">
                {post.profiles?.full_name ?? 'Member'}
                {post.profiles?.eo_chapter && ` · ${post.profiles.eo_chapter}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
              </span>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-semibold group-hover:text-primary transition-colors leading-tight">
                {post.title}
              </h2>
              {showTypeBadge && post.board_type && (
                <span className={cn(
                  'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
                  post.board_type === 'community'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'bg-primary/10 text-primary'
                )}>
                  {post.board_type === 'community'
                    ? <><Users className="h-2.5 w-2.5" /> Community</>
                    : <><Briefcase className="h-2.5 w-2.5" /> Business</>
                  }
                </span>
              )}
            </div>

            {post.detail && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{post.detail}</p>
            )}

            <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
              <Badge variant="secondary" className="text-[10px]">{post.category}</Badge>

              {location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />{location}
                </span>
              )}

              <span className={cn(
                'flex items-center gap-1',
                isExpiringSoon && 'text-yellow-700 dark:text-yellow-400',
                isExpired && 'text-muted-foreground line-through',
              )}>
                <Clock className="h-3 w-3" />
                {isExpired
                  ? `Expired ${format(requiredBy, 'MMM d')}`
                  : isExpiringSoon
                    ? `Expires in ${daysLeft === 0 ? 'today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'}`}`
                    : `Needed by ${format(requiredBy, 'MMM d, yyyy')}`
                }
              </span>

              {post.response_count > 0 && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {post.response_count} {post.response_count === 1 ? 'reply' : 'replies'}
                </span>
              )}

              {post.status === 'fulfilled' && (
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3 w-3" /> Fulfilled
                </span>
              )}
            </div>

            {post.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {post.tags.slice(0, 5).map(tag => (
                  <span key={tag} className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
