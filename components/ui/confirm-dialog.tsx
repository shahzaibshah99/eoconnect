'use client'

import { isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ConfirmDialogProps {
  /** The element that opens the dialog when clicked. Must be a single element. */
  trigger: ReactNode
  title: string
  /** Body content. Pass a string or a ReactNode (e.g. for emphasis on a name). */
  description: ReactNode
  /** Label on the destructive button. Default 'Delete'. */
  confirmLabel?: string
  /** Label on the cancel button. Default 'Cancel'. */
  cancelLabel?: string
  /** Variant: 'destructive' renders confirm in red. Default 'destructive'. */
  variant?: 'destructive' | 'primary'
  /** Async handler. If it throws, the message surfaces in an inline Alert
   *  and the dialog stays open. If it resolves, the dialog closes. */
  onConfirm: () => Promise<void> | void
}

/**
 * Branded replacement for window.confirm(). Use this for any destructive
 * or irreversible action: matches the rest of the app's design system,
 * supports async handlers with inline error display, keyboard-accessible.
 *
 * Pattern:
 *
 *   <ConfirmDialog
 *     trigger={<Button variant="destructive">Delete</Button>}
 *     title="Delete this service?"
 *     description={<>Are you sure you want to delete <b>{name}</b>?</>}
 *     onConfirm={async () => { await deleteService(id); router.refresh() }}
 *   />
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  variant = 'destructive',
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    setError(null)
    setIsPending(true)
    try {
      await onConfirm()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsPending(false)
    }
  }

  // base-ui's <DialogTrigger render={element} /> clones the passed element
  // and injects DialogTrigger's *own* children into it. When DialogTrigger
  // has no children (which is the case here), the clone ends up with
  // children set to undefined and any children inside the original element
  // are dropped — the trigger renders as a styled button shell with no
  // icon and no label.
  //
  // This was visible as: Manage Services Delete buttons rendering as
  // solid red rectangles with no "Delete" text (Anam, mobile QA), and
  // the listing Pause/Resume button rendering as a solid green rectangle
  // with no label. Both were diagnosed as a contrast bug at first; the
  // real cause was that the children never made it into the DOM.
  //
  // Fix: extract the trigger element's children and pass them through to
  // DialogTrigger. base-ui then re-injects them when it clones, putting
  // the icon + label back where they should be.
  const triggerElement = isValidElement(trigger) ? (trigger as ReactElement<{ children?: ReactNode }>) : null
  const triggerChildren = triggerElement?.props.children

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isPending) { setOpen(v); if (!v) setError(null) } }}>
      {triggerElement
        ? <DialogTrigger render={triggerElement}>{triggerChildren}</DialogTrigger>
        : <DialogTrigger>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-sm text-muted-foreground leading-relaxed">{description}</div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className={
              variant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }
          >
            {isPending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
