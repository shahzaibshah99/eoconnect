'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markFulfilled, extendPost } from '@/actions/bulletin'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CheckCircle2, CalendarPlus } from 'lucide-react'

interface PostActionsProps {
  postId: string
}

/**
 * Owner-only controls for managing the post lifecycle:
 *   - Mark fulfilled → closes replies, signals to the network need is met
 *   - Extend → adds 14 days to required_by for active but ongoing needs
 */
export function PostActions({ postId }: PostActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const extend = () => {
    startTransition(async () => {
      await extendPost(postId)
      router.refresh()
    })
  }

  return (
    <div className="flex gap-2 pt-2 border-t border-border">
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="outline" className="gap-1.5" disabled={isPending}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark fulfilled
          </Button>
        }
        title="Mark this need as fulfilled?"
        description="This signals to the network that your need has been met. Replies will be frozen. This cannot be undone."
        confirmLabel="Mark fulfilled"
        variant="primary"
        onConfirm={async () => {
          const res = await markFulfilled(postId)
          if (res.error) throw new Error(res.error)
          router.refresh()
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={extend}
        disabled={isPending}
      >
        <CalendarPlus className="h-3.5 w-3.5" /> Extend 14 days
      </Button>
    </div>
  )
}
