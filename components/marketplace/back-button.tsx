'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

interface BackButtonProps {
  /** Path to fall back to when there's no browser history (e.g. the
   *  user landed on this page directly from a deep link or new tab).
   *  Defaults to /marketplace. */
  fallback?: string
}

/**
 * "← Back" affordance on listing detail pages.
 *
 * Uses browser history (router.back()) so the user returns wherever
 * they came from — including the search page with their query and
 * filter URL params still intact. Native nav links (e.g. clicking
 * "Marketplace" in the navbar) reset the search; that's the trap
 * the user reported, so a per-page back button is the right tool.
 *
 * Falls back to a hard navigation to `fallback` when window.history
 * has no prior entry — meaning the user opened this listing in a
 * new tab or jumped straight into it from outside the app. Without
 * the fallback the button would do nothing in those cases.
 */
export function BackButton({ fallback = '/marketplace' }: BackButtonProps) {
  const router = useRouter()

  const handleClick = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push(fallback)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ChevronLeft className="h-4 w-4" />
      Back
    </button>
  )
}
