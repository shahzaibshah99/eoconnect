/**
 * Per-tab handoff for LinkedIn auto-fill data.
 *
 * The auto-fill banner can run on EITHER the onboarding page OR
 * the new-business wizard. When it runs on onboarding, the wizard
 * isn't mounted yet — we save the payload here so the wizard can
 * pick it up on mount. When it runs inside the wizard itself, the
 * cache isn't used.
 *
 * sessionStorage (not localStorage) on purpose:
 *   - Scoped to the tab — closing the browser drops the data.
 *   - Cleared explicitly after consume() so a stale payload never
 *     pre-fills a *second* business listing the same user creates
 *     in the same tab.
 *
 * The shape mirrors LinkedInAutofill from actions/linkedin-autofill.ts.
 * Defining it here lets us import only the type without dragging
 * the server action into client bundles that just need the cache.
 */
export interface LinkedInAutofill {
  name: string
  tagline: string
  description: string
  website: string
  founded_year: string
  team_size: '1-10' | '11-50' | '51-200' | '201-500' | '500+' | ''
  city: string
  country: string
  country_code: string
  phone: string
  tags: string
  category_ids: string[]
  custom_categories: string
  social_linkedin: string
  logo_url: string
  cover_url: string
}

const STORAGE_KEY = 'mm_linkedin_autofill_v1'

export function saveLinkedInAutofillToSession(data: LinkedInAutofill): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Storage quota or private mode — silently ignore.
  }
}

/**
 * Read AND remove the stashed payload. Atomic-by-convention so the
 * caller doesn't have to think about clearing it themselves.
 */
export function consumeLinkedInAutofillFromSession(): LinkedInAutofill | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    sessionStorage.removeItem(STORAGE_KEY)
    return JSON.parse(raw) as LinkedInAutofill
  } catch {
    return null
  }
}
