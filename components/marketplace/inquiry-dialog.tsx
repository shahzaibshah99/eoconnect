'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { sendInquiry } from '@/actions/messages'
import { toast } from 'sonner'
import { MessageCircle } from 'lucide-react'

interface ServiceOption {
  id: string
  title: string
  item_type?: string | null
}

interface InquiryDialogProps {
  businessId: string
  ownerId: string
  ownerName: string
  businessName: string
  services: ServiceOption[]
}

/**
 * Per scope F06: "Viewer taps 'Enquire about this listing' → selects
 * service/product of interest (provides context, no free text) →
 * confirm → in-platform message thread opens."
 *
 * Key changes from the old dialog:
 *   - Free-text message body removed. Inquiry = service selection only.
 *   - Auto-generated opening message: "I'm interested in [service]."
 *   - No accept/decline step — thread opens directly on submit.
 *   - If the listing has no services, the inquiry opens a general thread.
 */
export function InquiryDialog({
  businessId, ownerId, ownerName, businessName, services,
}: InquiryDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Derive the selected service label for the confirmation preview.
  const selectedService = services.find(s => s.id === serviceId)

  const submit = () => {
    setError(null)
    startTransition(async () => {
      // Auto-generate the opening message from the service selection.
      // No free text per scope — the service pick IS the context.
      const firstName = ownerName.split(' ')[0] || ownerName
      const autoBody = selectedService
        ? `Hi ${firstName}, I'm interested in your ${selectedService.item_type === 'product' ? 'product' : 'service'}: "${selectedService.title}".`
        : `Hi ${firstName}, I'd like to learn more about ${businessName}.`

      const res = await sendInquiry({
        owner_id: ownerId,
        business_id: businessId,
        service_id: serviceId || null,
        body: autoBody,
      })
      if (res.error) { setError(res.error); return }
      setOpen(false)
      if (res.pendingClaim) {
        toast.success("We've let the business know someone is interested — they'll respond once they claim their profile.")
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
          <Button className="w-full bg-primary text-primary-foreground font-bold gap-1.5" />
        }
      >
        <MessageCircle className="h-4 w-4" /> Enquire about this listing
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enquire about {businessName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Select what you&apos;re interested in. {ownerName.split(' ')[0]} will receive a
            notification and can reply in your Messages inbox.
          </p>

          {services.length > 0 ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">
                What are you interested in?
              </label>
              <Select
                value={serviceId || undefined}
                onValueChange={(v: string | null) => setServiceId(v ?? '')}
              >
                <SelectTrigger className="w-full h-10">
                  <SelectValue placeholder="Select a service or product…">
                    {(v: string | null) => {
                      const s = services.find(s => s.id === v)
                      if (!s) return 'Select a service or product…'
                      return (
                        <span>
                          {s.item_type === 'product' ? '📦' : '⚙️'}{' '}
                          {s.title}
                        </span>
                      )
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {services.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span>{s.item_type === 'product' ? '📦' : '⚙️'}</span>
                        <span>{s.title}</span>
                        {s.item_type && (
                          <span className="text-[10px] text-muted-foreground capitalize">
                            ({s.item_type})
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm text-muted-foreground">
              This business hasn&apos;t listed specific services yet. Your enquiry will
              open a general conversation.
            </div>
          )}

          {/* Preview of the auto-generated opening message */}
          {(selectedService || services.length === 0) && (
            <div className="bg-muted/30 border border-border rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 font-semibold">
                Your opening message (auto-generated)
              </p>
              <p className="text-sm">
                {selectedService
                  ? `Hi ${ownerName.split(' ')[0] || ownerName}, I'm interested in your ${selectedService.item_type === 'product' ? 'product' : 'service'}: "${selectedService.title}".`
                  : `Hi ${ownerName.split(' ')[0] || ownerName}, I'd like to learn more about ${businessName}.`
                }
              </p>
            </div>
          )}

          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={isPending || (services.length > 0 && !serviceId)}
          >
            {isPending ? 'Sending…' : 'Send enquiry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
