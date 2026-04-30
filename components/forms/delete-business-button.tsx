'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteBusiness } from '@/actions/business'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Trash2 } from 'lucide-react'

interface Props {
  businessId: string
  businessName: string
}

/**
 * Destructive action with friction: opens a modal that demands the user
 * type the business name to enable the delete button. Same pattern as
 * GitHub repo deletion. Prevents accidental click-throughs.
 */
export function DeleteBusinessButton({ businessId, businessName }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const matches = confirmText.trim().toLowerCase() === businessName.trim().toLowerCase()

  const onConfirm = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setError(null)
    if (!matches) {
      setError('Type the business name exactly to confirm.')
      return
    }
    startTransition(async () => {
      const result = await deleteBusiness(businessId, confirmText)
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
      // After delete, send the user back to their dashboard. The list page
      // redirects to /dashboard/business/new automatically when they have
      // no businesses left.
      router.push('/dashboard/business/edit')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          />
        }
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Delete this business
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{businessName}&rdquo;?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Alert variant="destructive">
            <AlertDescription>
              This permanently deletes the business and all of its services,
              portfolio documents, reviews, analytics, and ad campaigns.
              This cannot be undone.
            </AlertDescription>
          </Alert>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-name">
              Type <span className="font-mono font-semibold">{businessName}</span> to confirm
            </Label>
            <Input
              id="confirm-name"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={businessName}
              autoComplete="off"
              autoFocus
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!matches || isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
