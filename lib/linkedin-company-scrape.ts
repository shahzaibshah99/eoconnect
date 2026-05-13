import 'server-only'

const RAPIDAPI_HOST = 'professional-network-data.p.rapidapi.com'

export interface LinkedInCompanyData {
  name: string | null
  description: string | null
  founded_year: number | null
  employee_count: string | null
  industry: string | null
  website: string | null
  logo_url: string | null
  cover_url: string | null
  specialties: string[]
}

/**
 * Extract the company username from a LinkedIn company URL.
 * e.g. https://www.linkedin.com/company/openai/ → "openai"
 */
function extractUsername(input: string): string | null {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/linkedin\.com\/company\/([a-z0-9._-]+)/i)
  if (urlMatch) return urlMatch[1].toLowerCase()
  if (/^[a-z0-9._-]+$/i.test(trimmed)) return trimmed.toLowerCase()
  return null
}

function mapStaffSize(range: string | undefined, exact: number | undefined): string | null {
  const r = (range ?? '').trim()
  switch (r) {
    case '1': case '2-10': return '1-10'
    case '11-50': return '11-50'
    case '51-200': return '51-200'
    case '201-500': return '201-500'
    case '501-1000': case '1001-5000': case '5001-10000': case '10001+': return '500+'
  }
  if (typeof exact === 'number' && isFinite(exact)) {
    if (exact <= 10) return '1-10'
    if (exact <= 50) return '11-50'
    if (exact <= 200) return '51-200'
    if (exact <= 500) return '201-500'
    return '500+'
  }
  return null
}

function extractFoundedYear(founded: unknown): number | null {
  if (founded == null) return null
  if (typeof founded === 'number') return isFinite(founded) ? founded : null
  if (typeof founded === 'string') {
    const y = parseInt(founded.slice(0, 4))
    return y > 1800 && y <= new Date().getFullYear() ? y : null
  }
  if (typeof founded === 'object') {
    const obj = founded as { year?: number | string | null }
    if (obj.year != null) {
      const y = Number(obj.year)
      return isFinite(y) && y > 1800 ? y : null
    }
  }
  return null
}

function pickLargestImage<T extends { url: string; width?: number }>(arr: T[] | undefined, fallback?: string | null): string | null {
  if (!arr || arr.length === 0) return fallback ?? null
  return [...arr].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? fallback ?? null
}

export async function scrapeLinkedInCompany(linkedinUrl: string): Promise<LinkedInCompanyData | null> {
  if (!process.env.RAPIDAPI_LINKEDIN_KEY) {
    console.warn('[linkedin-company] RAPIDAPI_LINKEDIN_KEY not set — skipping')
    return null
  }

  const username = extractUsername(linkedinUrl)
  if (!username) {
    console.warn('[linkedin-company] could not extract username from:', linkedinUrl)
    return null
  }

  // Same endpoint as the business listing autofill feature
  const apiUrl = `https://${RAPIDAPI_HOST}/get-company-details?username=${encodeURIComponent(username)}`

  try {
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': process.env.RAPIDAPI_LINKEDIN_KEY,
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      console.error(`[linkedin-company] RapidAPI ${res.status} for username: ${username}`)
      return null
    }

    const json = await res.json() as { success?: boolean; data?: Record<string, unknown> }
    if (!json?.success || !json.data) {
      console.warn('[linkedin-company] no data returned for:', username)
      return null
    }

    const d = json.data
    const logoSrc = pickLargestImage(d.logos as Array<{ url: string; width?: number }>, (d.Images as { logo?: string })?.logo)
    const coverSrc = pickLargestImage(d.backgroundCoverImages as Array<{ url: string; width?: number }>, (d.Images as { cover?: string })?.cover)
    const hq = (d.headquarter as { city?: string; country?: string } | undefined) ?? {}

    return {
      name: (d.name as string | null) ?? null,
      description: (d.description as string | null) ?? null,
      founded_year: extractFoundedYear(d.founded),
      employee_count: mapStaffSize(d.staffCountRange as string | undefined, d.staffCount as number | undefined),
      industry: (d.industries as string[] | undefined)?.[0] ?? null,
      website: (d.website as string | null) ?? null,
      logo_url: logoSrc,
      cover_url: coverSrc,
      specialties: ((d.specialities as string[] | undefined) ?? []).slice(0, 10),
    }
  } catch (err) {
    console.error('[linkedin-company] fetch failed:', err)
    return null
  }
}
