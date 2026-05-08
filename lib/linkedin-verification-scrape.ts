import 'server-only'
import type { TenantId } from '@/lib/tenant'

const RAPIDAPI_HOST = 'professional-network-data.p.rapidapi.com'

export type LinkedInSignal = 'yes' | 'no' | 'unclear'

/**
 * Scrape a LinkedIn personal profile via RapidAPI and decide whether
 * it shows EO/YPO membership. Result is a coarse 'yes' / 'no' /
 * 'unclear' that the admin queue surfaces as a supporting signal —
 * never auto-approves (per scope F01).
 *
 * Lifecycle:
 *   1. Member submits a verification with a LinkedIn URL.
 *   2. submitVerification fires this fire-and-forget after the row inserts.
 *   3. This writes the result back to verifications.linkedin_signal.
 *
 * Required env: RAPIDAPI_LINKEDIN_KEY (same key as the company-autofill
 * flow — single subscription covers both).
 *
 * Returns null on any error (network, API rate limit, bad shape) so
 * the admin sees "not checked" instead of a false negative.
 */
export async function scrapeProfileForMembership(
  linkedinUrl: string,
  tenantId: TenantId
): Promise<LinkedInSignal | null> {
  if (!process.env.RAPIDAPI_LINKEDIN_KEY) {
    console.warn('[verification-scrape] RAPIDAPI_LINKEDIN_KEY not set — skipping')
    return null
  }

  // Refuse non-/in/ URLs early. Sending a company URL to the person
  // endpoint wastes quota and returns garbage shape we can't parse.
  if (!/linkedin\.com\/in\//i.test(linkedinUrl)) {
    return null
  }

  const apiUrl = `https://${RAPIDAPI_HOST}/get-profile-data-by-url?url=${encodeURIComponent(linkedinUrl)}`

  let json: unknown
  try {
    const res = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': process.env.RAPIDAPI_LINKEDIN_KEY,
      },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`[verification-scrape] RapidAPI ${res.status} for ${linkedinUrl}`)
      return null
    }
    json = await res.json()
  } catch (err) {
    console.error('[verification-scrape] fetch threw:', err)
    return null
  }

  return classifyMembership(json, tenantId)
}

// ── Classification ────────────────────────────────────────────
//
// We don't trust upstream to keep its response shape stable, so we
// flatten anything that looks searchable into a single string and
// match keywords. This trades surgical precision for resilience —
// admin always reviews anyway.

const EO_STRONG = [
  /entrepreneurs['']?\s*organization/i,
  /\beo\s+(member|alumni|accelerator|chapter|sponsor)\b/i,
  /\b(member|alumni|accelerator)\s+of\s+eo\b/i,
]

const YPO_STRONG = [
  /young\s+presidents['']?\s*organization/i,
  /\bypo\s+(member|alumni|chapter|sponsor)\b/i,
  /\b(member|alumni)\s+of\s+ypo\b/i,
]

// Weak — bare acronym in plausible context. Falls to 'unclear' rather
// than 'yes' because EO/YPO are short tokens with high collision risk
// (e.g. "EO of operations" inside a CFO bio).
const EO_WEAK = /\beo\b/i
const YPO_WEAK = /\bypo\b/i

function classifyMembership(json: unknown, tenantId: TenantId): LinkedInSignal {
  const haystack = flattenStrings(json).join(' \n ')
  if (!haystack.trim()) return 'no'

  const strongPatterns = tenantId === 'ypo' ? YPO_STRONG : EO_STRONG
  for (const re of strongPatterns) {
    if (re.test(haystack)) return 'yes'
  }

  const weakPattern = tenantId === 'ypo' ? YPO_WEAK : EO_WEAK
  if (weakPattern.test(haystack)) return 'unclear'

  return 'no'
}

/**
 * Walk an arbitrary JSON value and collect every string. Stops at
 * obviously-noisy fields (urls, image links) so the regex above
 * doesn't trip on a path containing "/eo/".
 */
function flattenStrings(value: unknown): string[] {
  const out: string[] = []
  const skipKeyRe = /^(url|link|image|photo|avatar|profile_picture|logo|cover|src)$/i

  function walk(v: unknown, key?: string) {
    if (v == null) return
    if (typeof v === 'string') {
      if (key && skipKeyRe.test(key)) return
      // Skip strings that look like URLs/paths regardless of key name.
      if (/^https?:\/\//i.test(v) || v.includes('/in/') || v.includes('linkedin.com')) return
      out.push(v)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, key)
      return
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        walk(val, k)
      }
    }
  }

  walk(value)
  return out
}
