import Link from 'next/link'
import Image from 'next/image'
import { MapPin, Star, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Business } from '@/types/database'
import { cn } from '@/lib/utils'

interface ListingCardProps {
  business: Business & {
    avg_rating?: number
    review_count?: number
    category_names?: string[]
    is_sponsored?: boolean
  }
}

export function ListingCard({ business }: ListingCardProps) {
  // Per F02: slow-replier listings stay searchable and accessible but
  // render with reduced opacity + a "Slow replier" label so members can
  // calibrate expectations. Activated by the daily cron once an owner
  // hasn't logged in for 90 days; cleared on next login.
  const isSlowReplier = business.slow_replier
  return (
    // h-full + flex-col on the card lets every grid cell stretch to
    // the tallest sibling. Internal sections then push the location
    // row to the bottom with mt-auto so the row of cards aligns
    // visually regardless of tagline length.
    <Link href={`/marketplace/${business.id}`} className="block h-full">
      <div className={cn(
        'group bg-card border border-border rounded-xl overflow-hidden hover:border-primary transition-all hover:shadow-lg flex flex-col h-full',
        isSlowReplier && 'opacity-70 grayscale-40 hover:opacity-90 hover:grayscale-0'
      )}>
        {business.cover_url ? (
          <div className="relative h-32 w-full">
            <Image src={business.cover_url} alt={business.name} fill className="object-cover" />
            {business.is_sponsored && (
              <span className="absolute top-2 right-2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-bold">
                Featured
              </span>
            )}
            {isSlowReplier && (
              <span className="absolute top-2 left-2 text-[10px] bg-muted/95 text-muted-foreground border border-border px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> Slow replier
              </span>
            )}
          </div>
        ) : (
          <div className="h-32 w-full bg-muted flex items-center justify-center relative">
            {business.is_sponsored && (
              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-bold">
                Featured
              </span>
            )}
            {isSlowReplier && (
              <span className="absolute top-2 left-2 text-[10px] bg-background/95 text-muted-foreground border border-border px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> Slow replier
              </span>
            )}
          </div>
        )}

        <div className="p-4 flex flex-col flex-1">
          <div className="flex items-start gap-3 mb-3">
            {business.logo_url ? (
              <div className="relative h-12 w-12 rounded-lg overflow-hidden flex-shrink-0 border border-border">
                <Image src={business.logo_url} alt={`${business.name} logo`} fill className="object-cover" />
              </div>
            ) : (
              <div className="h-12 w-12 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-primary font-bold text-sm">{business.name.charAt(0)}</span>
              </div>
            )}
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-tight truncate group-hover:text-primary transition-colors">
                {business.name}
              </h3>
              {/* Tagline area always reserves two lines so the title
                  block has a uniform height across cards regardless
                  of whether a tagline is present. line-clamp-2 caps
                  long taglines at the same height. */}
              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 min-h-[2.25rem]">
                {business.tagline ?? ''}
              </p>
            </div>
          </div>

          {business.category_names && business.category_names.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {business.category_names.slice(0, 2).map(name => (
                <Badge key={name} variant="secondary" className="text-xs">{name}</Badge>
              ))}
            </div>
          )}

          {/* Footer row pinned to the bottom via mt-auto so location
              + reviews align across cards even when the body content
              above varies in height. */}
          <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
            {(business.city || business.country) ? (
              <div className="flex items-center gap-1 min-w-0">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {[business.city, business.country].filter(Boolean).join(', ')}
                </span>
              </div>
            ) : (
              <span />
            )}
            <ReviewBadge count={business.review_count} avg={business.avg_rating} />
          </div>
        </div>
      </div>
    </Link>
  )
}

/**
 * Small "★ 4.6 (12)" or "No reviews" badge for the card footer.
 * Always renders something so the footer row stays visually
 * balanced — empty state shows a muted "No reviews yet" instead
 * of leaving the slot blank.
 */
function ReviewBadge({ count, avg }: { count?: number; avg?: number }) {
  if (count === undefined || count === 0 || avg === undefined) {
    return <span className="text-[11px] text-muted-foreground/70 flex-shrink-0">No reviews</span>
  }
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <Star className="h-3 w-3 fill-primary text-primary" />
      <span className="font-medium text-foreground">{avg.toFixed(1)}</span>
      <span className="text-muted-foreground">({count})</span>
    </div>
  )
}
