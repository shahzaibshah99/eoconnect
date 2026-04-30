'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { Settings, User, Menu } from 'lucide-react'
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

interface NavbarProps {
  profile: Profile | null
  unreadMessages?: number
  adsEnabled?: boolean
}

const baseLinks = [
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/dashboard', label: 'Business Dashboard' },
  { href: '/dashboard/messages', label: 'Messages' },
] as const

export function Navbar({ profile, unreadMessages = 0, adsEnabled = false }: NavbarProps) {
  const navLinks = adsEnabled
    ? [...baseLinks, { href: '/dashboard/ads', label: 'Ads' }]
    : baseLinks
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

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
                  return (
                    <DropdownMenuItem key={link.href}>
                      <Link
                        href={link.href}
                        className={cn(
                          'flex items-center w-full',
                          isActive && 'text-primary font-medium'
                        )}
                      >
                        {link.label}
                      </Link>
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
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
          </nav>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* R2-05: chat icon removed — duplicates the "Messages" nav link.
              Unread badge now lives on the nav link itself (see navLinks above).
              R2-11: NotificationBell hidden until alert behavior is defined.
              Bring back when push/in-app notifications ship. */}
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
    </header>
  )
}
