'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface LogoProps {
  /** 'lockup' = full Member Market logo, 'mark' = monogram square only */
  variant?: 'lockup' | 'mark'
  /** Force a color variant. Default 'auto' picks based on the active theme. */
  colorMode?: 'auto' | 'dark' | 'light'
  className?: string
  /** Pixel height. Default 36. */
  height?: number
}

/**
 * Member Market logo.
 *
 * Two designer-supplied SVGs live in /public/images:
 *   member-market-logo.svg        — dark wordmark, white-mark interior. For light backgrounds.
 *   member-market-logo-white.svg  — white wordmark, white-mark interior. For dark backgrounds.
 *
 * `colorMode='auto'` watches `<html class="dark">` and swaps live so the logo
 * stays legible across theme toggles without a refresh.
 */
export function Logo({ variant = 'lockup', colorMode = 'auto', className, height = 36 }: LogoProps) {
  const isDark = useIsDark(colorMode)

  if (variant === 'mark') {
    // Render only the monogram by inheriting the SVG aspect (4-bar mark).
    // Crop to just the left mark by clipping width to height (the mark is square).
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={isDark ? '/images/member-market-logo-white.svg' : '/images/member-market-logo.svg'}
        alt="Member Market"
        style={{ height, width: height, objectFit: 'cover', objectPosition: 'left' }}
        className={cn('flex-shrink-0 select-none', className)}
        draggable={false}
      />
    )
  }

  // Lockup: full SVG (mark + wordmark).
  // NOTE: do NOT set display via inline style here — the parent often passes
  // `hidden sm:block` (or similar responsive utilities) via className to hide
  // the lockup at mobile breakpoints in favor of the mark variant. Inline
  // styles win over Tailwind's `hidden`, which used to cause both lockup AND
  // mark to render simultaneously at mobile.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={isDark ? '/images/member-market-logo-white.svg' : '/images/member-market-logo.svg'}
      alt="Member Market"
      style={{ height, width: 'auto' }}
      className={cn('flex-shrink-0 select-none', className)}
      draggable={false}
    />
  )
}

function useIsDark(mode: 'auto' | 'dark' | 'light'): boolean {
  const [isDark, setIsDark] = useState(() => mode === 'dark')

  useEffect(() => {
    if (mode !== 'auto') {
      setIsDark(mode === 'dark')
      return
    }
    if (typeof window === 'undefined') return
    const root = document.documentElement
    // next-themes is configured with attribute="data-theme" in app/layout.tsx,
    // so we watch that attribute. Also fall back to system preference and the
    // `class="dark"` convention for safety.
    const update = () => {
      const dataTheme = root.getAttribute('data-theme')
      if (dataTheme === 'dark') return setIsDark(true)
      if (dataTheme === 'light') return setIsDark(false)
      // 'system' (or unset) → follow the OS preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setIsDark(prefersDark || root.classList.contains('dark'))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    return () => {
      observer.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [mode])

  return isDark
}
