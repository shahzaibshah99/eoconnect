import 'server-only'
import { embed } from 'ai'
import { openai } from '@ai-sdk/openai'

// In-process cache for query embeddings. Search queries repeat heavily —
// caching across requests on the same warm instance kills the OpenAI round
// trip for hot keywords ("marketing", "real estate", etc.).
const embeddingCache = new Map<string, number[]>()
const EMBEDDING_CACHE_MAX = 500
// 6s — was 3s. Same logic as the parse-search bump: cold OpenAI
// connections from a fresh serverless instance can routinely take
// 2-4s for the first call, before the per-process cache kicks in
// for subsequent identical queries. 3s was missing the legitimate
// success window.
const EMBEDDING_TIMEOUT_MS = 6000

/**
 * Get a 1536-dim embedding for a piece of text.
 * Uses text-embedding-3-small (cheap + fast — ~$0.02 per million tokens).
 * Returns null if no API key or on error so callers can no-op gracefully.
 *
 * Wraps the OpenAI call in:
 *   - in-process cache (key: lowercased trimmed text, capped at 500 entries)
 *   - 3s timeout (prevents pathological OpenAI latency from stalling search)
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const cacheKey = trimmed.toLowerCase().slice(0, 200)
  const cached = embeddingCache.get(cacheKey)
  if (cached) return cached

  try {
    const result = await Promise.race([
      embed({
        model: openai.textEmbeddingModel('text-embedding-3-small'),
        value: trimmed.slice(0, 8000), // OpenAI hard caps ~8K tokens; chars is a safe proxy
      }).then(r => r.embedding),
      new Promise<number[]>((_, reject) =>
        setTimeout(() => reject(new Error('embedding timeout')), EMBEDDING_TIMEOUT_MS)
      ),
    ])

    if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
      const firstKey = embeddingCache.keys().next().value
      if (firstKey) embeddingCache.delete(firstKey)
    }
    embeddingCache.set(cacheKey, result)
    return result
  } catch (err) {
    console.error('getEmbedding failed:', err)
    return null
  }
}

/**
 * Build the canonical "what to embed" text for a business.
 * Includes name, tagline, description, tags, location, and service titles —
 * everything a user might naturally search for.
 */
export function businessEmbeddingText(input: {
  name: string
  tagline?: string | null
  description?: string | null
  tags?: string[] | null
  city?: string | null
  country?: string | null
  serviceTitles?: string[]
}): string {
  const parts: string[] = [input.name]
  if (input.tagline) parts.push(input.tagline)
  if (input.description) parts.push(input.description)
  if (input.tags && input.tags.length > 0) parts.push(`Tags: ${input.tags.join(', ')}`)
  if (input.city || input.country) parts.push(`Location: ${[input.city, input.country].filter(Boolean).join(', ')}`)
  if (input.serviceTitles && input.serviceTitles.length > 0) {
    parts.push(`Services offered: ${input.serviceTitles.join('; ')}`)
  }
  return parts.join('\n')
}
