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
 * Member Market logo (inlined SVG).
 *
 * The previous version pointed an <img> at /images/member-market-logo.svg
 * in /public/. That kept breaking in production:
 *  - Stale Docker images that didn't include /public/ assets,
 *  - Reverse proxy configs that ate /images/* paths,
 *  - Build cache misses on Dokploy.
 *
 * Inlining removes the network dependency entirely — the SVG markup is
 * part of the JS bundle, so the logo can never 404. Trade-off is ~700 bytes
 * of inlined markup per render vs. one extra GET; for a tiny per-page logo
 * that's a clear win.
 *
 * Two color variants:
 *  - light  → dark forest green wordmark + mark, amber accents
 *  - dark   → white wordmark + mark, amber accents (legible on dark bg)
 *
 * `colorMode='auto'` watches `<html data-theme="…">` (next-themes config in
 * app/layout.tsx) and falls back to the OS `prefers-color-scheme` query.
 */
export function Logo({ variant = 'lockup', colorMode = 'auto', className, height = 36 }: LogoProps) {
  const isDark = useIsDark(colorMode)
  // Wordmark "member" + mark box swap to white in dark mode for legibility.
  // The amber accent (.market + the four bars in the mark) is constant.
  const ink = isDark ? '#FFFFFF' : '#0A2218'
  const accent = '#D4821A'

  if (variant === 'mark') {
    // Square monogram only — used in mobile navbars and tight spaces.
    return (
      <svg
        viewBox="0 0 64 64"
        height={height}
        width={height}
        xmlns="http://www.w3.org/2000/svg"
        className={cn('flex-shrink-0 select-none', className)}
        role="img"
        aria-label="Member Market"
      >
        <rect width="64" height="64" rx="12" fill={ink} />
        <rect x="12" y="20" width="7" height="28" rx="2" fill={accent} />
        <rect x="12" y="20" width="18" height="8" rx="2" fill={accent} />
        <rect x="23" y="20" width="7" height="28" rx="2" fill={accent} />
        <rect x="23" y="20" width="18" height="8" rx="2" fill={accent} />
        <rect x="34" y="20" width="7" height="28" rx="2" fill={accent} />
        <rect x="45" y="20" width="7" height="28" rx="2" fill={accent} />
      </svg>
    )
  }

  // Full lockup. Source viewBox is 380×72 → aspect ratio ~5.28:1.
  // We compute width from the requested height to preserve it.
  // NOTE: do NOT set inline display — parents often pass `hidden sm:block`
  // (or similar) via className to swap variants at the mobile breakpoint.
  // Inline styles would beat the Tailwind utility and cause both variants
  // to render simultaneously.
  const width = Math.round((height * 380) / 72)
  return (
    <svg
      viewBox="0 0 380 72"
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      className={cn('flex-shrink-0 select-none', className)}
      role="img"
      aria-label="Member Market"
    >
      <g transform="translate(4, 4)">
        <rect width="64" height="64" rx="12" fill={ink} />
        <rect x="12" y="20" width="7" height="28" rx="2" fill={accent} />
        <rect x="12" y="20" width="18" height="8" rx="2" fill={accent} />
        <rect x="23" y="20" width="7" height="28" rx="2" fill={accent} />
        <rect x="23" y="20" width="18" height="8" rx="2" fill={accent} />
        <rect x="34" y="20" width="7" height="28" rx="2" fill={accent} />
        <rect x="45" y="20" width="7" height="28" rx="2" fill={accent} />
      </g>
      <text
        x="84"
        y="48"
        fontFamily="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
        fontSize="32"
        fontWeight="700"
        fill={ink}
      >
        member<tspan fill={accent}>.market</tspan>
      </text>
    </svg>
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
