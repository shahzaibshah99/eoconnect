'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Star, ExternalLink, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { adminUpdateReview, deleteReview } from '@/actions/admin'
import { ReplyForm } from '@/components/reviews/reply-form'

const MEMBERSHIP_LABEL: Record<string, string> = {
  current_member: 'Current Member',
  alumni: 'Alumni',
  accelerator: 'Accelerator',
}

export interface ReviewCardItem {
  id: string
  rating: number
  body: string | null
  owner_reply: string | null
  reviewerName: string
  reviewerAvatar: string | null
  reviewerChapter: string | null
  reviewerMembershipType: 'current_member' | 'alumni' | 'accelerator' | null
  /** The reviewer's own business they're reviewing AS. Null when
   *  they don't have one (display falls back to their name). */
  reviewerBusinessId: string | null
  reviewerBusinessName: string | null
  reviewerBusinessLogo: string | null
  /** Service of the reviewed listing this review is about. Optional. */
  serviceTitle: string | null
}

interface ReviewCardProps {
  review: ReviewCardItem
  /** True when current user owns the listing being reviewed.
   *  Drives the inline "Reply" form. */
  isListingOwner: boolean
  /** True when current user is chapter_admin or super_admin.
   *  Drives the edit + delete actions. */
  isAdmin: boolean
}

/**
 * Review card for the listing detail page.
 *
 * Identity hierarchy (from most-prominent to least):
 *   1. Reviewer's BUSINESS name (linked → their listing) when they
 *      have one — the more meaningful identity on a B2B marketplace
 *      than a person's name.
 *   2. Reviewer's NAME, EO chapter, and membership type as pills.
 *   3. Service the review is about (when the reviewer picked one).
 *
 * Falls back to person-name primary when the reviewer doesn't have
 * a business listed.
 *
 * Admin actions (edit, delete) live in a 3-dots dropdown — only
 * rendered when isAdmin is true. Members see no edit affordance:
 * reviews are submit-once.
 */
export function ReviewCard({ review, isListingOwner, isAdmin }: ReviewCardProps) {
  const hasBusiness = !!(review.reviewerBusinessId && review.reviewerBusinessName)

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10 flex-shrink-0">
          <AvatarImage src={review.reviewerBusinessLogo ?? review.reviewerAvatar ?? undefined} />
          <AvatarFallback className="bg-primary/15 text-primary text-sm font-bold">
            {(review.reviewerBusinessName ?? review.reviewerName).charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {/* Primary identity */}
              {hasBusiness ? (
                <a
                  href={`/marketplace/${review.reviewerBusinessId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-sm hover:underline"
                  title={`Open ${review.reviewerBusinessName} listing`}
                >
                  <span className="truncate">{review.reviewerBusinessName}</span>
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
              ) : (
                <p className="font-semibold text-sm truncate">{review.reviewerName}</p>
              )}

              {/* Stars */}
              <div className="flex gap-0.5 mt-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <Star
                    key={n}
                    className={cn(
                      'h-3.5 w-3.5',
                      n <= review.rating ? 'fill-primary text-primary' : 'text-muted-foreground'
                    )}
                  />
                ))}
              </div>

              {/* Member context as pills.
                  Only show the reviewer's name as a pill when the
                  primary identity was their business — otherwise
                  the name is already the heading and a duplicate
                  pill is noise. */}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {hasBusiness && (
                  <Badge variant="secondary" className="text-[10px]">{review.reviewerName}</Badge>
                )}
                {review.reviewerChapter && (
                  <Badge variant="secondary" className="text-[10px]">{review.reviewerChapter}</Badge>
                )}
                {review.reviewerMembershipType && (
                  <Badge variant="secondary" className="text-[10px]">
                    {MEMBERSHIP_LABEL[review.reviewerMembershipType] ?? review.reviewerMembershipType}
                  </Badge>
                )}
                {review.serviceTitle && (
                  <Badge variant="secondary" className="text-[10px]">
                    Re: {review.serviceTitle}
                  </Badge>
                )}
              </div>
            </div>

            {isAdmin && <AdminActions review={review} />}
          </div>

          {review.body && (
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{review.body}</p>
          )}

          {review.owner_reply && (
            <div className="mt-3 pl-4 border-l-2 border-primary/30">
              <p className="text-xs font-semibold text-primary mb-1">Owner response</p>
              <p className="text-sm text-muted-foreground">{review.owner_reply}</p>
            </div>
          )}

          {isListingOwner && (
            <ReplyForm reviewId={review.id} existing={review.owner_reply} />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 3-dots admin menu with Edit + Delete. Only rendered for admins.
 *
 * Edit opens an inline modal with rating + body fields backed by
 * the adminUpdateReview server action. Delete uses the existing
 * ConfirmDialog pattern wired to the existing deleteReview action.
 */
function AdminActions({ review }: { review: ReviewCardItem }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editRating, setEditRating] = useState(review.rating)
  const [editBody, setEditBody] = useState(review.body ?? '')
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()
  const [isDeleting, startDeleting] = useTransition()

  const handleSave = () => {
    setEditError(null)
    const fd = new FormData()
    fd.set('rating', String(editRating))
    fd.set('body', editBody)
    startSaving(async () => {
      const result = await adminUpdateReview(review.id, fd)
      if (result.error) {
        setEditError(result.error)
        return
      }
      setEditOpen(false)
      router.refresh()
    })
  }

  const handleDelete = () => {
    setDeleteError(null)
    startDeleting(async () => {
      const result = await deleteReview(review.id)
      if (result.error) {
        setDeleteError(result.error)
        return
      }
      setDeleteOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      {/* The dropdown only sets which dialog opens. Both the Edit
          and Delete dialogs live OUTSIDE the dropdown's portal so
          they survive when the dropdown closes (which it does the
          moment a menu item is selected). The previous attempt
          rendered the delete ConfirmDialog INSIDE the dropdown —
          and base-ui's portal teardown closed the dialog within a
          frame, hence the user's "popup flashes for a millisecond
          and vanishes" report. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Admin actions"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring flex-shrink-0"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-40">
          {/* base-ui's Menu.Item wraps onClick natively but does NOT
              fire on the React-synthetic `onSelect` (that one is for
              text-selection events on input elements). The previous
              code attached its handlers to onSelect and silently did
              nothing on click — exactly the user's "I click delete
              and nothing happens" report. */}
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={(v) => { if (!isSaving) setEditOpen(v) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit review</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium mb-2">Rating</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setEditRating(n)}
                    className="p-1"
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  >
                    <Star className={cn('h-6 w-6', n <= editRating ? 'fill-primary text-primary' : 'text-muted-foreground')} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Body</p>
              <Textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={5}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground mt-1">{editBody.length}/500</p>
            </div>
            {editError && (
              <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation. Independent dialog at this scope so
          the dropdown closing doesn't tear it down. */}
      <Dialog open={deleteOpen} onOpenChange={(v) => { if (!isDeleting) setDeleteOpen(v) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this review?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              This permanently removes the review. The reviewer can submit a new
              one but the original text and rating are gone.
            </p>
            {deleteError && (
              <Alert variant="destructive"><AlertDescription>{deleteError}</AlertDescription></Alert>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
