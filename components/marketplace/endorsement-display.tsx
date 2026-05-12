'use client'

import { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'

const MEMBERSHIP_LABEL: Record<string, string> = {
  current_member: 'Current EO Member',
  alumni: 'EO Alumni',
  accelerator: 'EO Accelerator',
}

export type EndorsementItem = {
  id: string
  from_member_id: string
  text: string | null
  created_at: string
  profiles?: {
    full_name?: string
    avatar_url?: string | null
    eo_chapter?: string | null
    eo_membership_type?: 'current_member' | 'alumni' | 'accelerator' | null
  } | null
}

interface EndorsementDisplayProps {
  endorsements: EndorsementItem[]
  businessName: string
}

export function EndorsementDisplay({ endorsements, businessName }: EndorsementDisplayProps) {
  const [expanded, setExpanded] = useState(false)

  const count = endorsements.length
  // Initials row — show max 6, then "+N more"
  const shownAvatars = endorsements.slice(0, 6)
  const extraCount = count > 6 ? count - 6 : 0

  // Text snippets — most recent 3 first (already ordered by created_at desc from query)
  const withText = endorsements.filter(e => e.text)
  const visibleSnippets = expanded ? withText : withText.slice(0, 3)
  const hasMore = withText.length > 3

  return (
    <div className="space-y-4">
      {/* Count summary header */}
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{count}</span>{' '}
        EO {count === 1 ? 'member has' : 'members have'} worked with {businessName}.
      </p>

      {/* Avatar initials row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {shownAvatars.map(e => (
          <Avatar key={e.id} className="h-9 w-9 border-2 border-background">
            <AvatarImage src={e.profiles?.avatar_url ?? undefined} />
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
              {(e.profiles?.full_name ?? '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
        {extraCount > 0 && (
          <div className="h-9 w-9 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[11px] font-semibold text-muted-foreground">
            +{extraCount}
          </div>
        )}
      </div>

      {/* Text snippets */}
      {withText.length > 0 && (
        <div className="space-y-2">
          {visibleSnippets.map(e => (
            <div key={e.id} className="bg-muted/50 rounded-lg px-4 py-3">
              <p className="text-sm text-foreground">&ldquo;{e.text}&rdquo;</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <p className="text-xs text-muted-foreground font-medium">
                  {e.profiles?.full_name ?? 'Member'}
                </p>
                {e.profiles?.eo_membership_type && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {MEMBERSHIP_LABEL[e.profiles.eo_membership_type] ?? e.profiles.eo_membership_type}
                  </Badge>
                )}
                {e.profiles?.eo_chapter && (
                  <span className="text-xs text-muted-foreground">{e.profiles.eo_chapter}</span>
                )}
              </div>
            </div>
          ))}

          {hasMore && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-1.5 text-muted-foreground"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? (
                <><ChevronUp className="h-4 w-4" /> Show less</>
              ) : (
                <><ChevronDown className="h-4 w-4" /> Show all {withText.length} endorsements</>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
