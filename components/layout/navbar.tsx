'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Settings, User, Menu, Megaphone, ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ThemeToggle } from './theme-toggle'
import { Logo } from './logo'
import { Button, buttonVariants } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { signOut } from '@/actions/auth'
import type { Profile } from '@/types/database'
import { cn } from '@/lib/utils'
import { MessagesNavLink } from './messages-nav-link'
import { SupportButton } from './support-button'
import { UnreadBadge } from './unread-badge'
import { NotificationsButton, type NotificationItem } from './notifications-button'

interface NavbarProps {
  profile: Profile | null
  unreadMessages?: number
  /** New-review notifications on the user's own listings since
   *  profile.notifications_seen_at. Drives the bell badge. */
  unreadNotifications?: number
  /** Most-recent reviews on the user's listings (last 5) for the
   *  bell dropdown body. */
  recentNotifications?: NotificationItem[]
  /** Business ids the current user owns. Passed to NotificationsButton
   *  so the realtime channel can client-filter incoming review inserts
   *  to only those for the user's listings. */
  ownedBusinessIds?: string[]
  adsEnabled?: boolean
}

const baseLinks = [
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/dashboard', label: 'Business Dashboard' },
  { href: '/dashboard/messages', label: 'Messages' },
] as const

export function Navbar({
  profile,
  unreadMessages = 0,
  unreadNotifications = 0,
  recentNotifications = [],
  ownedBusinessIds = [],
  adsEnabled = false,
}: NavbarProps) {
  const navLinks = adsEnabled
    ? [...baseLinks, { href: '/dashboard/ads', label: 'Ads' }]
    : baseLinks
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  // Andrew wanted a "Post a Need" entry on the nav to gauge interest for
  // a future reverse-marketplace flow (members post needs, AI matches
  // businesses). For now this is a placeholder — clicking opens a
  // coming-soon dialog. No route, no server work.
  const [postNeedOpen, setPostNeedOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
      <div className="mx-auto max-w-[1280px] px-3 sm:px-4 md:px-6 flex h-16 items-center justify-between gap-2">
        <div className="flex items-center gap-8 min-w-0">
          {/* Mobile hamburger — opens nav links in a dropdown */}
          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {navLinks.map(link => {
                  const isActive = link.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname.startsWith(link.href)
                  const isMessages = link.href === '/dashboard/messages'
                  return (
                    <DropdownMenuItem key={link.href}>
                      <Link
                        href={link.href}
                        className={cn(
                          'flex items-center justify-between gap-2 w-full',
                          isActive && 'text-primary font-medium'
                        )}
                      >
                        <span>{link.label}</span>
                        {/* Mobile users had no unread indicator at all
                            — Messages was just a plain link in the
                            hamburger dropdown. Mirroring the badge
                            from the desktop nav here. */}
                        {isMessages && (
                          <UnreadBadge
                            userId={profile?.id ?? null}
                            initialUnread={unreadMessages}
                          />
                        )}
                      </Link>
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => { e.preventDefault(); setPostNeedOpen(true) }}
                  className="cursor-pointer"
                >
                  <span className="flex items-center gap-2 w-full">
                    <Megaphone className="h-4 w-4" />
                    Post a Need
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Link href="/dashboard/services/new" className="flex items-center w-full text-primary font-medium">
                    + Add Service
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Link href="/marketplace" aria-label="Member Market home">
            <Logo height={36} className="hidden sm:block" />
            <Logo variant="mark" height={36} className="sm:hidden" />
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(link => {
              if (link.href === '/dashboard/messages') {
                return (
                  <MessagesNavLink
                    key={link.href}
                    userId={profile?.id ?? null}
                    initialUnread={unreadMessages}
                    baseClass="px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5"
                    activeClass="bg-primary/10 text-primary"
                    idleClass="text-muted-foreground hover:text-foreground hover:bg-muted"
                  />
                )
              }
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5',
                    (link.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(link.href))
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
            <button
              type="button"
              onClick={() => setPostNeedOpen(true)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Megaphone className="h-4 w-4" />
              Post a Need
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* R2-05: chat icon removed — duplicates the "Messages" nav link.
              Unread badge now lives on the nav link itself (see navLinks above).
              R2-11: NotificationBell hidden until alert behavior is defined.
              Bring back when push/in-app notifications ship. */}
          <NotificationsButton
            unread={unreadNotifications}
            recent={recentNotifications}
            ownedBusinessIds={ownedBusinessIds}
          />
          <SupportButton memberName={profile?.full_name ?? null} />
          <ThemeToggle />
          <Link
            href="/dashboard/services/new"
            className={cn(buttonVariants({ size: 'sm' }), 'hidden sm:inline-flex bg-primary text-primary-foreground font-bold ml-1')}
          >
            Add Service
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="ml-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-8 w-8 cursor-pointer">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                  {profile?.full_name?.charAt(0).toUpperCase() ?? 'U'}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{profile?.full_name}</p>
                <p className="text-xs text-muted-foreground">{profile?.eo_chapter}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Link href="/dashboard/account" className="flex items-center w-full">
                  <User className="mr-2 h-4 w-4" />My Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href="/dashboard/business/edit" className="flex items-center w-full">
                  <Settings className="mr-2 h-4 w-4" />My Businesses
                </Link>
              </DropdownMenuItem>
              {profile && profile.verification_tag === 'unverified' ? (
                <DropdownMenuItem>
                  <Link href="/dashboard/verify" className="flex items-center w-full text-yellow-700 dark:text-yellow-400">
                    <ShieldAlert className="mr-2 h-4 w-4" />Verify membership
                  </Link>
                </DropdownMenuItem>
              ) : profile && profile.verification_tag !== 'unverified' && (
                <DropdownMenuItem>
                  <Link href="/dashboard/verify" className="flex items-center w-full">
                    <ShieldCheck className="mr-2 h-4 w-4" />Verification status
                  </Link>
                </DropdownMenuItem>
              )}
              {profile?.role && ['chapter_admin', 'super_admin'].includes(profile.role) && (
                <DropdownMenuItem>
                  <Link href="/admin" className="flex items-center w-full">Admin Panel</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive cursor-pointer"
                onClick={() => startTransition(() => { signOut() })}
                disabled={isPending}
              >
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={postNeedOpen} onOpenChange={setPostNeedOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Megaphone className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-center">Post a Need — Coming Soon</DialogTitle>
            <DialogDescription className="text-center">
              Soon you&apos;ll be able to post what you&apos;re looking for and we&apos;ll
              notify members whose businesses match. Stay tuned.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </header>
  )
}
