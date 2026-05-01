'use server'

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { iso2ToCountryName } from '@/lib/iso-country-names'
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const RAPIDAPI_HOST = 'professional-network-data.p.rapidapi.com'

type TeamSize = '1-10' | '11-50' | '51-200' | '201-500' | '500+'

export interface LinkedInAutofill {
  name: string
  tagline: string
  description: string
  website: string
  founded_year: string
  team_size: TeamSize | ''
  city: string
  country: string
  country_code: string
  phone: string
  /** Joined comma-separated for the existing TagInput. */
  tags: string
  /** Pre-mapped slugs of our existing categories. */
  category_ids: string[]
  /** Industries from LinkedIn we couldn't map to a known slug —
   *  goes into the wizard's `custom_categories` field so the
   *  member can review and the create flow auto-creates them. */
  custom_categories: string
  social_linkedin: string
  /** Already uploaded to eoconnect-media — just stuff into the
   *  hidden form fields on submit. */
  logo_url: string
  cover_url: string
}

export interface LinkedInAutofillResult {
  error: string | null
  data?: LinkedInAutofill
}

/**
 * Pull a LinkedIn company username from a paste of either:
 *   - https://www.linkedin.com/company/google
 *   - https://www.linkedin.com/company/google/
 *   - linkedin.com/company/google
 *   - "google" on its own
 *
 * Returns null when nothing matches — caller surfaces a friendly error.
 */
function extractUsername(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const urlMatch = trimmed.match(/linkedin\.com\/company\/([a-z0-9._-]+)/i)
  if (urlMatch) return urlMatch[1].toLowerCase()
  // Bare username: a-z, 0-9, dot, underscore, dash. LinkedIn usernames
  // never have spaces or special chars beyond that.
  if (/^[a-z0-9._-]+$/i.test(trimmed)) return trimmed.toLowerCase()
  return null
}

/**
 * Map LinkedIn's staff range strings (and exact count fallback) to
 * the team_size enum the wizard uses. LinkedIn's ranges are wider
 * than ours at the top end so 501+ collapses to "500+".
 */
function mapStaffSize(range: string | undefined, exact: number | undefined): TeamSize | '' {
  const r = (range ?? '').trim()
  switch (r) {
    case '1':
    case '2-10':
      return '1-10'
    case '11-50':
      return '11-50'
    case '51-200':
      return '51-200'
    case '201-500':
      return '201-500'
    case '501-1000':
    case '1001-5000':
    case '5001-10000':
    case '10001+':
      return '500+'
  }
  // Fall back to the exact count when range string is unrecognized.
  if (typeof exact === 'number' && Number.isFinite(exact)) {
    if (exact <= 10) return '1-10'
    if (exact <= 50) return '11-50'
    if (exact <= 200) return '51-200'
    if (exact <= 500) return '201-500'
    return '500+'
  }
  return ''
}

/**
 * LinkedIn's tagline is often empty for big companies. When it is,
 * borrow the first sentence of the description as a stand-in (capped
 * at 100 chars to fit our tagline limit).
 */
function deriveTagline(tagline: string | undefined, description: string | undefined): string {
  const t = tagline?.trim()
  if (t) return t.slice(0, 100)
  const d = description?.trim()
  if (!d) return ''
  // Take up to first sentence terminator OR first 100 chars
  const firstSentence = d.split(/[.\n]/)[0]?.trim() ?? ''
  return firstSentence.slice(0, 100)
}

/**
 * LinkedIn's logos[] / backgroundCoverImages[] arrays come back at
 * multiple resolutions. Pick the largest one that's still reasonable
 * for the marketplace card render.
 */
function pickLargestImage<T extends { url: string; width?: number }>(arr: T[] | undefined, fallback?: string | null): string | null {
  if (!arr || arr.length === 0) return fallback ?? null
  // Sort by width descending; fall back to first when widths missing.
  const sorted = [...arr].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  return sorted[0]?.url ?? fallback ?? null
}

/**
 * Download an image at a URL into the eoconnect-media bucket.
 *
 * LinkedIn's CDN URLs are signed and expire (`?e=1779321600` etc.)
 * so we have to copy the bytes into our own storage to keep them
 * stable on the listing.
 *
 * Uses the SUPABASE_SERVICE_ROLE_KEY so this runs server-side
 * without an authenticated user session — needed because this
 * action runs before the user has even saved the listing.
 *
 * Returns the new public URL or null if anything along the path
 * failed (we just give up on that image; the rest of the auto-fill
 * still works).
 */
async function downloadAndStoreImage(
  sourceUrl: string,
  folder: 'logos' | 'covers',
  username: string,
): Promise<string | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return null
  }
  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) {
      console.error(`[linkedin-autofill] image fetch ${res.status} for ${sourceUrl}`)
      return null
    }
    const contentType = res.headers.get('content-type') ?? 'image/png'
    const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('png') ? 'png' : 'img'
    const buffer = Buffer.from(await res.arrayBuffer())

    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    )
    const path = `${folder}/linkedin-${username}-${Date.now()}.${ext}`
    const { error: uploadErr } = await admin.storage
      .from('eoconnect-media')
      .upload(path, buffer, { contentType, upsert: false })
    if (uploadErr) {
      console.error(`[linkedin-autofill] upload failed for ${path}:`, uploadErr.message)
      return null
    }
    return admin.storage.from('eoconnect-media').getPublicUrl(path).data.publicUrl
  } catch (err) {
    console.error('[linkedin-autofill] download/upload error:', err)
    return null
  }
}

/**
 * Map LinkedIn industries to our category slugs via an LLM call.
 *
 * Returns:
 *   matched   — slugs that are in our categories table
 *   unmatched — original industry strings that don't have a clean
 *               equivalent; they get dropped into the
 *               custom_categories textbox so the create flow
 *               auto-creates them as new Category rows.
 *
 * Falls through gracefully without OpenAI: returns matched=[] and
 * stuffs every industry into unmatched.
 */
async function mapIndustriesToCategories(
  industries: string[],
  categoryList: Array<{ slug: string; name: string }>,
): Promise<{ matched: string[]; unmatched: string[] }> {
  if (!industries.length) return { matched: [], unmatched: [] }
  if (!process.env.OPENAI_API_KEY || !categoryList.length) {
    return { matched: [], unmatched: industries }
  }

  const Schema = z.object({
    matched: z.array(z.string()).describe('Slugs that match the LinkedIn industries (use exact slug strings from the available list).'),
    unmatched: z.array(z.string()).describe('LinkedIn industries that have no clean equivalent in the slug list. Returned verbatim.'),
  })

  try {
    const result = await Promise.race([
      generateText({
        model: openai('gpt-5-nano'),
        output: Output.object({ schema: Schema }),
        prompt: `You map LinkedIn industries to a marketplace's category slugs.

Available category slugs:
${categoryList.map(c => `${c.slug}: ${c.name}`).join('\n')}

LinkedIn industries to map:
${industries.map(i => `- ${i}`).join('\n')}

Rules:
- Only return slugs from the list. Never invent.
- Match semantically: "Software Development" → web-app-development OR saas-software-products (whichever fits the available list).
- Up to 3 matched slugs total — pick the strongest fits.
- Industries with no good slug match go into "unmatched" verbatim.`,
      }).then(r => r.output),
      new Promise<{ matched: string[]; unmatched: string[] }>((_, reject) =>
        setTimeout(() => reject(new Error('mapIndustries timeout')), 5000)
      ),
    ])

    const validSlugs = new Set(categoryList.map(c => c.slug))
    const matched = (result.matched ?? []).filter(s => validSlugs.has(s)).slice(0, 3)
    const unmatched = result.unmatched ?? []
    return { matched, unmatched }
  } catch (err) {
    console.error('[linkedin-autofill] industries map failed:', err)
    return { matched: [], unmatched: industries }
  }
}

/**
 * Auto-fill the business creation form from a LinkedIn company URL.
 *
 * Flow (all server-side):
 *   1. Parse a LinkedIn URL or username from the user's paste.
 *   2. Hit RapidAPI's professional-network-data company endpoint.
 *   3. Map fields directly + use an LLM to map industries → our
 *      category slugs.
 *   4. Download logo + cover from LinkedIn's CDN into our own
 *      eoconnect-media bucket so the URLs survive the LinkedIn
 *      signature expiry.
 *   5. Return a payload the wizard can drop into its formData.
 *
 * Required env vars:
 *   RAPIDAPI_LINKEDIN_KEY       (the RapidAPI subscription key)
 *   SUPABASE_SERVICE_ROLE_KEY   (for image upload — already required)
 *   NEXT_PUBLIC_SUPABASE_URL    (already required)
 *
 * Optional:
 *   OPENAI_API_KEY              (industries → category mapping; falls
 *                                back to dropping into custom_categories
 *                                when missing or model is restricted)
 */
export async function autofillFromLinkedIn(input: string): Promise<LinkedInAutofillResult> {
  if (!process.env.RAPIDAPI_LINKEDIN_KEY) {
    return { error: 'LinkedIn auto-fill is not configured on this deployment.' }
  }

  // Light auth check — user must be signed in to invoke this since
  // it consumes the RapidAPI quota and uploads to our storage.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please sign in to use auto-fill.' }

  const username = extractUsername(input)
  if (!username) {
    return { error: "That doesn't look like a LinkedIn company URL. Try something like https://www.linkedin.com/company/your-company" }
  }

  // Pull the LinkedIn payload
  const url = `https://${RAPIDAPI_HOST}/get-company-details?username=${encodeURIComponent(username)}`
  let json: { success?: boolean; data?: LinkedInResponse } | null = null
  try {
    const apiRes = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': process.env.RAPIDAPI_LINKEDIN_KEY,
      },
      // Don't trust upstream caches — we want fresh data each time.
      cache: 'no-store',
    })
    if (!apiRes.ok) {
      console.error('[linkedin-autofill] RapidAPI returned', apiRes.status, await apiRes.text())
      return { error: `Couldn't reach LinkedIn (status ${apiRes.status}). Try again or fill manually.` }
    }
    json = await apiRes.json() as { success?: boolean; data?: LinkedInResponse }
  } catch (err) {
    console.error('[linkedin-autofill] fetch threw:', err)
    return { error: 'Network error contacting LinkedIn. Try again or fill manually.' }
  }
  if (!json?.success || !json.data) {
    return { error: "We couldn't find that company on LinkedIn." }
  }
  const d = json.data

  // Pick highest-resolution image variants.
  const logoSrc = pickLargestImage(d.logos, d.Images?.logo)
  const coverSrc = pickLargestImage(d.backgroundCoverImages, d.Images?.cover)

  // Pull categories list once for the industries mapping.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = supabase as any
  const { data: categoryRows } = await dbAny
    .from('categories')
    .select('slug, name')
    .eq('active', true) as { data: Array<{ slug: string; name: string }> | null }

  // Run image downloads + industries mapping in parallel — they're
  // independent and dominate the latency budget for this action.
  const [logoStored, coverStored, industriesMapped] = await Promise.all([
    logoSrc ? downloadAndStoreImage(logoSrc, 'logos', username) : Promise.resolve(null),
    coverSrc ? downloadAndStoreImage(coverSrc, 'covers', username) : Promise.resolve(null),
    mapIndustriesToCategories(d.industries ?? [], categoryRows ?? []),
  ])

  const hq = d.headquarter ?? {}
  const tags = (d.specialities ?? []).slice(0, 10).map(s => s.trim()).filter(Boolean)

  return {
    error: null,
    data: {
      name: d.name ?? '',
      tagline: deriveTagline(d.tagline, d.description),
      description: (d.description ?? '').slice(0, 2000),
      website: d.website ?? '',
      founded_year: d.founded ? String(d.founded) : '',
      team_size: mapStaffSize(d.staffCountRange, d.staffCount),
      city: hq.city ?? '',
      country: iso2ToCountryName(hq.countryCode ?? hq.country ?? null),
      country_code: (hq.countryCode ?? '').toUpperCase(),
      phone: d.phone ?? '',
      tags: tags.join(', '),
      category_ids: industriesMapped.matched,
      custom_categories: industriesMapped.unmatched.join(', '),
      social_linkedin: d.linkedinUrl ?? '',
      logo_url: logoStored ?? '',
      cover_url: coverStored ?? '',
    },
  }
}

// ── Type sketch for the RapidAPI response ─────────────────────────
// Loose because the upstream isn't ours; we tolerate missing fields
// and extra ones via Pick + index access in the action above.
interface LinkedInResponse {
  name?: string
  tagline?: string
  description?: string
  website?: string
  founded?: number | null
  staffCount?: number
  staffCountRange?: string
  phone?: string
  linkedinUrl?: string
  Images?: { logo?: string; cover?: string }
  logos?: Array<{ url: string; width?: number; height?: number }>
  backgroundCoverImages?: Array<{ url: string; width?: number; height?: number }>
  industries?: string[]
  specialities?: string[]
  headquarter?: {
    countryCode?: string
    country?: string
    city?: string
    geographicArea?: string
    postalCode?: string
    line1?: string
  }
}
