'use client'

import { useState, useTransition } from 'react'
import { getMessageThread, type AdminThreadMessage } from '@/actions/flags'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { Eye, Loader2, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MessageThreadDialogProps {
  messageId: string
  targetName: string | null
}

export function MessageThreadDialog({ messageId, targetName }: MessageThreadDialogProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AdminThreadMessage[]>([])
  const [businessName, setBusinessName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleOpen = () => {
    setOpen(true)
    if (messages.length > 0) return
    startTransition(async () => {
      const res = await getMessageThread(messageId)
      if (res.error) { setError(res.error); return }
      setMessages(res.messages ?? [])
      setBusinessName(res.business_name ?? null)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <Eye className="h-3 w-3" /> View thread
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base">
              Message thread{businessName ? ` — ${businessName}` : ''}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">Read-only · Admin flag review only</p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {isPending && (
              <div className="flex items-center gap-2 justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive text-center py-4">{error}</p>
            )}

            {!isPending && messages.length === 0 && !error && (
              <p className="text-sm text-muted-foreground text-center py-4">No messages found.</p>
            )}

            {messages.map(m => (
              <div
                key={m.id}
                className={cn(
                  'rounded-lg p-3 text-sm',
                  m.is_flagged_message
                    ? 'bg-red-500/10 border border-red-500/30'
                    : 'bg-muted/50'
                )}
              >
                <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-xs">{m.sender_name ?? 'Unknown member'}</span>
                  {m.is_flagged_message && (
                    <Badge className="text-[10px] bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30 border">
                      Flagged message
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    {format(new Date(m.created_at), 'MMM d, yyyy · HH:mm')}
                  </span>
                </div>
                {m.body && <p className="text-muted-foreground leading-relaxed">{m.body}</p>}
                {m.attachment_name && (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                    <Paperclip className="h-3 w-3" /> {m.attachment_name}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
