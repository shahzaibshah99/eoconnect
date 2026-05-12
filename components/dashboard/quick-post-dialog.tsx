'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PostWizard } from '@/components/bulletin/post-wizard'
import { Plus, Users, Briefcase } from 'lucide-react'

export function QuickPostDialog() {
  const [open, setOpen] = useState(false)
  const [boardType, setBoardType] = useState<'business' | 'community' | null>(null)

  const handleClose = () => {
    setOpen(false)
    setBoardType(null)
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5" size="sm">
        <Plus className="h-4 w-4" /> Quick post
      </Button>

      <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Post a need</DialogTitle>
          </DialogHeader>

          {/* Step 1: pick board type */}
          {!boardType && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <button
                type="button"
                onClick={() => setBoardType('business')}
                className="flex flex-col items-center gap-2 p-5 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <Briefcase className="h-6 w-6 text-primary" />
                <span className="font-semibold text-sm">Business Need</span>
                <span className="text-[11px] text-muted-foreground text-center">
                  Looking for a service, supplier, or professional
                </span>
              </button>
              <button
                type="button"
                onClick={() => setBoardType('community')}
                className="flex flex-col items-center gap-2 p-5 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <Users className="h-6 w-6 text-primary" />
                <span className="font-semibold text-sm">Community Ask</span>
                <span className="text-[11px] text-muted-foreground text-center">
                  Personal, lifestyle, or connection request
                </span>
              </button>
            </div>
          )}

          {/* Step 2: post wizard */}
          {boardType && (
            <PostWizard boardType={boardType} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
