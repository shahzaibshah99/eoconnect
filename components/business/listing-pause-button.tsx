'use client'

import { useState } from 'react'
import { Pause, Play, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { updateBusinessStatus } from '@/actions/business'
import { useRouter } from 'next/navigation'

interface ListingPauseButtonProps {
  businessId: string
  status: 'draft' | 'published' | 'paused'
  pausedBy: 'owner' | 'admin' | null
}

/**
 * Member-side pause/resume control.
 *
 * Three rendering paths:
 *   1. Listing is published          → "Pause listing" button
 *   2. Listing is paused by the owner → "Resume listing" button
 *   3. Listing is paused by an admin → read-only banner explaining why
 *
 * Path 3 exists because giving the owner a "Resume" button when an admin
 * has paused them lets them undo every moderation hold. The server-side
 * action also refuses owner-resumes of admin pauses, but hiding the
 * button is the friendlier UX — they're not even tempted to click it
 * and get a wall-of-error.
 *
 * Drafts (never published) don't show this control; the user publishes
 * them through the normal save flow.
 */
export function ListingPauseButton({ businessId, status, pausedBy }: ListingPauseButtonProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  if (status === 'draft') return null

  // Admin pause — explain rather than offer a button that would 4xx.
  if (status === 'paused' && pausedBy === 'admin') {
    return (
      <Alert className="border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/5">
        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <AlertDescription>
          <p className="font-medium text-amber-900 dark:text-amber-200">Paused by an administrator</p>
          <p className="text-sm text-amber-800/80 dark:text-amber-200/80 mt-1">
            This listing is currently hidden from the marketplace as part of a moderation review.
            It can only be resumed by an administrator. Reach out to the EO team if you have
            questions.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  const isPaused = status === 'paused'
  const nextStatus: 'paused' | 'published' = isPaused ? 'published' : 'paused'
  const label = isPaused ? 'Resume listing' : 'Pause listing'
  const Icon = isPaused ? Play : Pause

  const handleConfirm = async () => {
    setError(null)
    const result = await updateBusinessStatus(businessId, nextStatus)
    if (result.error) {
      // Throw so ConfirmDialog surfaces it inline and keeps the dialog open.
      throw new Error(result.error)
    }
    // Force a refresh so the new status reflects in the parent server
    // component — revalidatePath inside the action invalidates the cache,
    // but the client view needs router.refresh() to actually re-fetch.
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2">
      <ConfirmDialog
        trigger={
          <Button
            type="button"
            variant={isPaused ? 'default' : 'outline'}
            className="gap-2 self-start"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        }
        title={isPaused ? 'Resume this listing?' : 'Pause this listing?'}
        description={
          isPaused
            ? 'Your listing will reappear in the marketplace and become searchable again.'
            : 'Your listing will be hidden from the marketplace. You can resume it any time.'
        }
        confirmLabel={isPaused ? 'Resume' : 'Pause'}
        variant="primary"
        onConfirm={handleConfirm}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
