import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import type { Category } from '@/types/database'

export interface ParsedSearch {
  categorySlugs: string[]
  city: string | null
  country: string | null
  keywords: string | null
}

// OpenAI's strict structured-output mode requires every field to be in `required`,
// so we use .nullable() instead of .optional() and treat null as "not extracted".
const ParsedSearchSchema = z.object({
  categorySlugs: z.array(z.string()).describe('Matching category slugs from the provided list (exact slug strings). Empty array if none match.'),
  city: z.string().nullable().describe('City name if the query mentions a city (lowercase). null if not mentioned.'),
  country: z.string().nullable().describe('Country name if mentioned (title case). null if not mentioned.'),
  keywords: z.string().nullable().describe('Remaining descriptive terms for full-text search after removing category and location words. null if no remaining terms.'),
})

// Per-process LRU-ish cache. Search queries repeat heavily ("marketing",
// "real estate", etc.) and the parser is a 1-3s OpenAI round trip — caching
// the parsed result for the lifetime of the serverless instance is plenty
// to flatten the hot-query latency without any infra.
const parseCache = new Map<string, ParsedSearch>()
const PARSE_CACHE_MAX = 200

// Hard timeout so a slow OpenAI response doesn't block the entire
// search page. At 8s we abort and fall through to the embedding-only
// path — still useful because vector similarity alone returns highly
// relevant results for most natural-language queries.
//
// Was 2.5s — too tight in practice. gpt-5-nano with structured output
// (Output.object schema) reliably takes 2-5s on a cold serverless
// instance, even when the model is fully accessible. With 2.5s we
// were timing out before the first token came back, falling through
// to the empty parse, and losing the city/country/category extraction
// the parser provides on top of vector search.
const PARSE_TIMEOUT_MS = 8000

function shouldSkipParser(query: string): boolean {
  // Single-keyword queries get nothing from the parser — there's no
  // city/country to extract and the embedding handles category intent.
  // Cuts ~1.5-3s off "marketing", "developers", "lawyers" type searches.
  const words = query.trim().split(/\s+/).filter(Boolean)
  return words.length <= 2 && !/\b(in|at|near|from)\b/i.test(query)
}

export async function parseSearchQuery(
  query: string,
  categories: Pick<Category, 'slug' | 'name'>[]
): Promise<ParsedSearch> {
  const empty: ParsedSearch = { categorySlugs: [], city: null, country: null, keywords: query }
  if (!process.env.OPENAI_API_KEY) return empty

  // Fast path: short queries skip the parser entirely.
  if (shouldSkipParser(query)) {
    return empty
  }

  const cacheKey = query.trim().toLowerCase()
  const cached = parseCache.get(cacheKey)
  if (cached) return cached

  try {
    const categoryList = categories.map(c => `${c.slug}: ${c.name}`).join('\n')
    // Track the underlying generateText promise so its rejection
    // (e.g. a 403 model_not_found) is logged with the real reason
    // rather than just swallowed under "parse timeout". Without this
    // a model-access problem looks identical to a slow response.
    const genPromise = generateText({
      model: openai('gpt-5-nano'),
      output: Output.object({ schema: ParsedSearchSchema }),
      prompt: `You are a search query parser for a B2B marketplace of EO (Entrepreneurs' Organization) member businesses.

Available categories (slug: name):
${categoryList}

Parse this user query into structured filters:
"${query}"

Rules:
- Match category slugs ONLY from the list above (use the slug exactly).
- Match the SEMANTIC intent — "lawyers" → legal-services, "developers" → web-app-development, "ai consultancy" → ai-machine-learning + consulting-advisory.
- Extract city and country if mentioned (e.g. "in sydney" → city: sydney). Cities should be lowercase.
- Put remaining descriptive terms in keywords (e.g. "fintech" or "saas"). Leave empty if none.
- Return empty arrays/strings when uncertain — never invent.`,
    }).then(r => r.output)
    genPromise.catch(err => {
      // Fires regardless of whether timeout won the race — gives us
      // the actual API error in logs even when we already returned
      // the empty fallback to the caller.
      console.error('parseSearchQuery underlying call rejected:', err instanceof Error ? err.message : err)
    })

    const result = await Promise.race([
      genPromise,
      new Promise<ParsedSearch>((_, reject) =>
        setTimeout(() => reject(new Error('parse timeout')), PARSE_TIMEOUT_MS)
      ),
    ])

    // Cap cache size — drop oldest when we hit the ceiling.
    if (parseCache.size >= PARSE_CACHE_MAX) {
      const firstKey = parseCache.keys().next().value
      if (firstKey) parseCache.delete(firstKey)
    }
    parseCache.set(cacheKey, result)
    return result
  } catch (err) {
    console.error('parseSearchQuery failed (returning empty fallback):', err)
    return empty
  }
}
