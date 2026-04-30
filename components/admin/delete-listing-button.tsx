'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteBusinessAdmin } from '@/actions/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Props {
  businessId: string
  businessName: string
}

/**
 * Admin-side destructive delete with the same typed-name friction as the
 * owner-side one. Calls deleteBusinessAdmin which uses the service-role
 * client + chapter scope check (super_admin bypasses; chapter_admin must
 * be assigned a country/city scope that matches the listing's owner).
 */
export function AdminDeleteListingButton({ businessId, businessName }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const matches = confirmText.trim().toLowerCase() === businessName.trim().toLowerCase()

  const onConfirm = () => {
    setError(null)
    if (!matches) {
      setError('Type the business name exactly to confirm.')
      return
    }
    startTransition(async () => {
      const result = await deleteBusinessAdmin(businessId, confirmText)
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
      setConfirmText('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setError(null); setConfirmText('') } }}>
      <DialogTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          />
        }
      >
        Delete
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{businessName}&rdquo;?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Alert variant="destructive">
            <AlertDescription>
              Permanently removes this business and all of its services, portfolio
              documents, reviews, analytics, and ad campaigns. The owner&apos;s past
              conversations are kept (without the listing reference) so message
              history isn&apos;t lost.
            </AlertDescription>
          </Alert>
          <div className="space-y-1.5">
            <Label htmlFor="admin-confirm-name">
              Type <span className="font-mono font-semibold">{businessName}</span> to confirm
            </Label>
            <Input
              id="admin-confirm-name"
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
