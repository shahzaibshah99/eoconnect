'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { sendInquiry } from '@/actions/messages'
import { toast } from 'sonner'

interface ServiceOption {
  id: string
  title: string
}

interface InquiryDialogProps {
  businessId: string
  ownerId: string
  ownerName: string
  businessName: string
  services: ServiceOption[]
}

/**
 * R2-06: Send Inquiry modal. Replaces the old "click does nothing visible" flow.
 *
 * On submit:
 *   1. Calls sendInquiry — creates/reuses a conversation AND sends the message in one go
 *   2. Shows a confirmation toast inside the modal, then redirects to the conversation
 *      so the user can immediately see their message + continue chatting
 *
 * The modal trigger is the existing "Send Inquiry" button on the listing page.
 */
export function InquiryDialog({
  businessId, ownerId, ownerName, businessName, services,
}: InquiryDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? '')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    setError(null)
    if (!body.trim()) {
      setError('Add a short message so the owner knows what you’re asking about.')
      return
    }
    startTransition(async () => {
      const res = await sendInquiry({
        owner_id: ownerId,
        business_id: businessId,
        service_id: serviceId || null,
        body: body.trim(),
      })
      if (res.error) {
        setError(res.error)
        return
      }
      setOpen(false)
      // Pre-populated listings have no real owner yet — the action emailed
      // the invite address with a claim link. Surface that to the user
      // rather than dropping them into an empty messages page.
      if (res.pendingClaim) {
        toast.success("We've passed your message to the business — we'll let them know to claim their listing and reply.")
        return
      }
      if (res.conversationId) {
        router.push(`/dashboard/messages?conversation=${res.conversationId}`)
      } else {
        router.push('/dashboard/messages')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="w-full bg-primary text-primary-foreground font-bold" />
        }
      >
        Send Inquiry
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Inquire about {businessName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Send a message directly to {ownerName}. They’ll reply in your Messages inbox.
          </p>

          {services.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="service_id">Which service are you interested in?</Label>
              <Select value={serviceId || undefined} onValueChange={(v: string | null) => setServiceId(v ?? '')}>
                <SelectTrigger id="service_id" className="w-full h-10">
                  <SelectValue placeholder="Pick a service…">
                    {/* base-ui's Select renders the raw value (a UUID) by default —
                        map it back to the human-readable service title here. */}
                    {(v: string | null) => services.find(s => s.id === v)?.title ?? 'Pick a service…'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {services.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="body">Your message *</Label>
            <Textarea
              id="body"
              rows={5}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={`Hi ${ownerName.split(' ')[0] || ''}, I’m interested in…`}
              maxLength={5000}
            />
            <p className="text-xs text-muted-foreground text-right">
              {body.length} / 5000
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? 'Sending…' : 'Send inquiry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
