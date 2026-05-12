'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateSponsorPoc } from '@/actions/chapter-manager'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Pencil, Mail } from 'lucide-react'

interface Sponsor {
  id: string
  name: string
  email: string | null
  tagline: string | null
  logo_url: string | null
  status: string
}

interface SponsorPocListProps {
  chapterId: number
  sponsors: Sponsor[]
}

function PocDialog({ sponsor, chapterId, onClose }: { sponsor: Sponsor; chapterId: number; onClose: () => void }) {
  const router = useRouter()
  const [pocName, setPocName] = useState('')
  const [pocEmail, setPocEmail] = useState(sponsor.email ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    setError(null)
    startTransition(async () => {
      const res = await updateSponsorPoc({
        business_id: sponsor.id,
        chapter_id: chapterId,
        poc_name: pocName.trim() || undefined,
        poc_email: pocEmail.trim() || undefined,
      })
      if (res.error) { setError(res.error); return }
      router.refresh()
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Set sponsor contact — {sponsor.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            This contact receives inquiry notifications for this sponsor listing.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="poc-name">Contact name</Label>
            <Input
              id="poc-name"
              value={pocName}
              onChange={e => setPocName(e.target.value)}
              placeholder="e.g. Sarah Chen"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="poc-email">Contact email <span className="text-destructive">*</span></Label>
            <Input
              id="poc-email"
              type="email"
              value={pocEmail}
              onChange={e => setPocEmail(e.target.value)}
              placeholder="contact@company.com"
            />
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={isPending} className="flex-1">
              {isPending ? 'Saving…' : 'Save contact'}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SponsorPocList({ chapterId, sponsors }: SponsorPocListProps) {
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null)

  if (sponsors.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No sponsor listings found in this chapter yet. Sponsors are added by the App Admin.
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {sponsors.map(s => (
          <div key={s.id} className="flex items-center gap-4 bg-card border border-border rounded-xl p-4">
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src={s.logo_url ?? undefined} />
              <AvatarFallback className="bg-primary/15 text-primary text-sm font-bold">
                {s.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{s.name}</p>
              {s.tagline && <p className="text-xs text-muted-foreground truncate">{s.tagline}</p>}
              {s.email ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                  <Mail className="h-3 w-3 shrink-0" /> {s.email}
                </p>
              ) : (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5">No contact set</p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => setEditingSponsor(s)}
            >
              <Pencil className="h-3.5 w-3.5" />
              {s.email ? 'Edit contact' : 'Set contact'}
            </Button>
          </div>
        ))}
      </div>

      {editingSponsor && (
        <PocDialog
          sponsor={editingSponsor}
          chapterId={chapterId}
          onClose={() => setEditingSponsor(null)}
        />
      )}
    </>
  )
}
