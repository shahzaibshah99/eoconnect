'use client'

import { useEffect, useState } from 'react'
import { Languages, Check } from 'lucide-react'

const LANGUAGES = [
  { code: 'en',    label: 'English' },
  { code: 'ja',    label: '日本語' },
  { code: 'zh-CN', label: '中文 (简体)' },
  { code: 'zh-TW', label: '中文 (繁體)' },
  { code: 'ko',    label: '한국어' },
  { code: 'ar',    label: 'العربية' },
  { code: 'es',    label: 'Español' },
  { code: 'fr',    label: 'Français' },
  { code: 'de',    label: 'Deutsch' },
  { code: 'pt',    label: 'Português' },
  { code: 'hi',    label: 'हिन्दी' },
  { code: 'th',    label: 'ภาษาไทย' },
  { code: 'vi',    label: 'Tiếng Việt' },
  { code: 'id',    label: 'Bahasa Indonesia' },
  { code: 'ms',    label: 'Bahasa Melayu' },
  { code: 'it',    label: 'Italiano' },
  { code: 'tr',    label: 'Türkçe' },
  { code: 'ru',    label: 'Русский' },
]

function clearGoogTransCookie() {
  const expired = 'expires=Thu, 01 Jan 1970 00:00:00 GMT'
  const hostname = window.location.hostname
  // Google sets the cookie on multiple domain variations — clear all of them
  const domains = [
    '',                           // no domain attr (current host)
    `domain=${hostname}`,         // exact hostname
    `domain=.${hostname}`,        // dot-prefixed (e.g. .eo.member.market)
  ]
  // Also try the parent domain (e.g. .member.market)
  const parts = hostname.split('.')
  if (parts.length > 2) {
    domains.push(`domain=.${parts.slice(-2).join('.')}`)
  }
  domains.forEach(d => {
    document.cookie = `googtrans=; path=/; ${expired}${d ? `; ${d}` : ''}`
  })
  // Clear from localStorage too in case Google cached it there
  try { localStorage.removeItem('googtrans') } catch {}
}

function setLanguage(code: string) {
  if (code === 'en') {
    clearGoogTransCookie()
    // Use href assignment (not reload) to force a completely fresh page load
    // without any cached translated content
    window.location.href = window.location.pathname + window.location.search
  } else {
    const val = `/en/${code}`
    const hostname = window.location.hostname
    document.cookie = `googtrans=${val}; path=/`
    document.cookie = `googtrans=${val}; path=/; domain=.${hostname}`
    window.location.reload()
  }
}

export function GoogleTranslate() {
  const [current, setCurrent] = useState('en')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Read current language from cookie — client only to avoid hydration mismatch
    const match = document.cookie.match(/googtrans=\/en\/([^;]+)/)
    if (match) setCurrent(match[1])

    // Load the translation engine invisibly
    if (document.getElementById('gt-engine-script')) return

    const hidden = document.createElement('div')
    hidden.id = 'gt-engine-hidden'
    hidden.style.display = 'none'
    document.body.appendChild(hidden)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).googleTranslateElementInit = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const GT = (window as any).google?.translate?.TranslateElement
      if (GT) new GT({ pageLanguage: 'en', autoDisplay: false }, 'gt-engine-hidden')
    }

    const script = document.createElement('script')
    script.id = 'gt-engine-script'
    script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
    script.async = true
    document.body.appendChild(script)

  }, [])

  const isTranslated = current !== 'en'

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Translate page"
        title="Translate page"
        onClick={() => setOpen(v => !v)}
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors ${
          isTranslated
            ? 'text-primary bg-primary/10'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
      >
        <Languages className="h-[18px] w-[18px]" />
        {isTranslated && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-48 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
            <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border" translate="no">
              Translate page
            </p>
            <div className="max-h-72 overflow-y-auto py-1" translate="no">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => { setOpen(false); setLanguage(lang.code) }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                >
                  {lang.label}
                  {current === lang.code && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
