/**
 * Website scraper for pre-population of business listings.
 *
 * Extracts from meta tags + JSON-LD structured data:
 *   name         → og:site_name or <title>
 *   tagline      → first sentence of description
 *   description  → og:description or meta description
 *   cover_url    → og:image (hero/banner image)
 *   logo_url     → JSON-LD logo, apple-touch-icon, or /favicon.ico
 *   phone        → JSON-LD telephone
 *   founded_year → JSON-LD foundingDate
 */

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.com.au',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me',
  'fastmail.com', 'zoho.com', 'yandex.com',
  'mail.com', 'msn.com',
])

export function domainFromEmail(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain) return null
  if (GENERIC_EMAIL_DOMAINS.has(domain)) return null
  return `https://${domain}`
}

export interface ScrapeResult {
  name: string | null
  tagline: string | null
  description: string | null
  cover_url: string | null
  logo_url: string | null
  phone: string | null
  founded_year: number | null
  url: string
}

function makeAbsolute(src: string, base: string): string {
  if (src.startsWith('http')) return src
  if (src.startsWith('//')) return `https:${src}`
  const origin = new URL(base).origin
  return `${origin}${src.startsWith('/') ? '' : '/'}${src}`
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim()
}

function extractMeta(html: string, ...patterns: RegExp[]): string | null {
  for (const pat of patterns) {
    const m = html.match(pat)
    if (m?.[1]?.trim()) return decodeHtmlEntities(m[1])
  }
  return null
}

export async function scrapeWebsiteBasics(url: string): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    name: null, tagline: null, description: null,
    cover_url: null, logo_url: null,
    phone: null, founded_year: null,
    url,
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MemberMarket/1.0; +https://member.market)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    if (!res.ok) return result
    const html = await res.text()

    // ── Business name ────────────────────────────────────────────
    result.name = extractMeta(html,
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,120})["']/i,
      /<meta[^>]+content=["']([^"']{1,120})["'][^>]+property=["']og:site_name["']/i,
    ) ?? (() => {
      const raw = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]
      if (!raw) return null
      const t = decodeHtmlEntities(raw)
      return (t.split(/\s*[\|–—\-]\s*/)[0]?.trim() ?? t) || null
    })()

    // ── Description ───────────────────────────────────────────────
    const fullDesc = extractMeta(html,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,1000})["']/i,
      /<meta[^>]+content=["']([^"']{1,1000})["'][^>]+property=["']og:description["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,1000})["']/i,
      /<meta[^>]+content=["']([^"']{1,1000})["'][^>]+name=["']description["']/i,
    )
    result.description = fullDesc

    if (fullDesc) {
      const sentence = fullDesc.split(/[.!?]/)[0]?.trim()
      result.tagline = (sentence && sentence.length >= 10 && sentence.length <= 120)
        ? sentence
        : fullDesc.slice(0, 110).trim()
    }

    // ── Cover image: og:image → twitter:image → skip if none ─────
    const coverSrc = extractMeta(html,
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']{1,500})["']/i,
      /<meta[^>]+content=["']([^"']{1,500})["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']{1,500})["']/i,
      /<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']twitter:image["']/i,
    )
    if (coverSrc) result.cover_url = makeAbsolute(coverSrc, url)

    // ── Description fallbacks: twitter:description → body text ───
    if (!result.description) {
      result.description = extractMeta(html,
        /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']{1,1000})["']/i,
        /<meta[^>]+content=["']([^"']{1,1000})["'][^>]+name=["']twitter:description["']/i,
      )
    }
    // Last resort: grab first meaningful paragraph from the body
    if (!result.description) {
      const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      const pMatch = stripped.match(/<p[^>]*>([^<]{40,500})<\/p>/i)
      if (pMatch) result.description = pMatch[1].replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
    }

    if (result.description && !result.tagline) {
      const sentence = result.description.split(/[.!?]/)[0]?.trim()
      result.tagline = (sentence && sentence.length >= 10 && sentence.length <= 120)
        ? sentence
        : result.description.slice(0, 110).trim()
    }

    // ── Logo: apple-touch-icon → icon → /favicon.ico ─────────────
    const touchIcon = extractMeta(html,
      /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']{1,300})["']/i,
      /<link[^>]+href=["']([^"']{1,300})["'][^>]+rel=["'][^"']*apple-touch-icon[^"']*["']/i,
    )
    const shortcutIcon = extractMeta(html,
      /<link[^>]+rel=["'][^"']*(?:shortcut icon|icon)[^"']*["'][^>]+href=["']([^"']{1,300})["']/i,
      /<link[^>]+href=["']([^"']{1,300})["'][^>]+rel=["'][^"']*(?:shortcut icon|icon)[^"']*["']/i,
    )
    const rawLogo = touchIcon ?? shortcutIcon
    if (rawLogo) {
      result.logo_url = makeAbsolute(rawLogo, url)
    } else {
      // Google's favicon service returns a higher-res version (128px)
      // than the raw /favicon.ico which is often 16x16
      const domain = new URL(url).hostname
      result.logo_url = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    }

    // ── JSON-LD structured data (Organization / LocalBusiness) ───
    const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    for (const match of jsonLdMatches) {
      try {
        const data = JSON.parse(match[1])
        const orgs = Array.isArray(data) ? data : [data]
        for (const org of orgs) {
          const type = (org['@type'] ?? '').toString().toLowerCase()
          if (!type.includes('organization') && !type.includes('business') && !type.includes('corporation')) continue

          if (!result.phone && org.telephone) {
            result.phone = String(org.telephone).trim()
          }
          if (!result.founded_year && org.foundingDate) {
            const y = parseInt(String(org.foundingDate).slice(0, 4))
            if (y > 1800 && y <= new Date().getFullYear()) result.founded_year = y
          }
          if (!result.logo_url && org.logo) {
            const logoUrl = typeof org.logo === 'string' ? org.logo : org.logo?.url
            if (logoUrl) result.logo_url = makeAbsolute(String(logoUrl), url)
          }
          if (!result.name && org.name) result.name = String(org.name).slice(0, 120)
          if (!result.description && org.description) result.description = String(org.description).slice(0, 2000)
        }
      } catch {
        // malformed JSON-LD — skip
      }
    }

    // ── Founded year text fallback ───────────────────────────────
    // When JSON-LD doesn't have foundingDate, scan the page text for
    // common patterns: "Founded in 2015", "Est. 2010", "Since 2008",
    // "Established 2012", "Founded 2018"
    if (!result.founded_year) {
      const plainText = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
      const yearPatterns = [
        /founded\s+in\s+((?:19|20)\d{2})/i,
        /founded\s+((?:19|20)\d{2})/i,
        /est(?:ablished)?\.?\s+((?:19|20)\d{2})/i,
        /since\s+((?:19|20)\d{2})/i,
        /incorporated\s+in\s+((?:19|20)\d{2})/i,
        /established\s+in\s+((?:19|20)\d{2})/i,
      ]
      for (const pat of yearPatterns) {
        const m = plainText.match(pat)
        if (m) {
          const y = parseInt(m[1])
          if (y > 1800 && y <= new Date().getFullYear()) {
            result.founded_year = y
            break
          }
        }
      }
    }

  } catch {
    // Timeout, DNS failure, TLS — return what we have
  }

  return result
}
