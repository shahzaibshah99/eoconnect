import 'server-only'
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const TagsSchema = z.object({
  name: z.string().max(120),
  tags: z.array(z.string().max(40)).max(10),
  tagline: z.string().max(120),
  description: z.string().max(2000),
})

export interface GeneratedBusinessData {
  name: string
  tags: string[]
  tagline: string
  description: string
}

// Extract a readable company name hint from a domain.
// "71lbs.com" → "71lbs", "myhrpartner.com" → "myhrpartner"
// The AI uses this as one signal — it can capitalise and split compound words.
function domainHint(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').split('.')[0]
  } catch {
    return ''
  }
}

const GENERIC_NAMES = new Set([
  'home', 'homepage', 'welcome', 'index', 'default', 'untitled',
  'page', 'website', 'site', 'main', 'start', 'loading',
])

/**
 * AI-driven business data generator. The AI determines the real company
 * name from the website domain + all scraped signals, then generates a
 * polished description, tagline, and service tags — all in one pass.
 *
 * This replaces the old pattern of passing a pre-determined name and
 * having the AI blindly accept it. Now the AI is the intelligence layer
 * for name resolution too (e.g. domain "71lbs.com" → "71lbs",
 * description mentions "myHR Partner" → "myHR Partner").
 */
export async function generateBusinessTags(input: {
  websiteUrl: string | null
  scrapedName: string | null
  rawDescription: string | null
  industry: string | null
  specialties: string[]
  contactName: string | null
}): Promise<GeneratedBusinessData | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[generate-business-tags] OPENAI_API_KEY not set — skipping')
    return null
  }

  const domain = input.websiteUrl ? domainHint(input.websiteUrl) : ''
  const scrapedIsGeneric = !input.scrapedName || GENERIC_NAMES.has(input.scrapedName.toLowerCase().trim())

  const context = [
    input.websiteUrl  ? `Website URL: ${input.websiteUrl}` : null,
    domain            ? `Domain (use to derive name if needed): ${domain}` : null,
    !scrapedIsGeneric ? `Scraped site name: ${input.scrapedName}` : `Scraped site name: "${input.scrapedName}" (generic — ignore, derive from domain)`,
    input.rawDescription ? `Page description: ${input.rawDescription}` : null,
    input.industry    ? `Industry (LinkedIn): ${input.industry}` : null,
    input.specialties.length > 0 ? `Specialties (LinkedIn): ${input.specialties.join(', ')}` : null,
    input.contactName ? `Contact name (person, not company): ${input.contactName}` : null,
  ].filter(Boolean).join('\n')

  try {
    const result = await generateText({
      model: openai('gpt-5-nano'),
      output: Output.object({ schema: TagsSchema }),
      prompt: `You generate business listing data for a B2B marketplace for EO (Entrepreneurs' Organization) members.

Given the scraped website details below, return ALL four fields:

- "name": The REAL company name. Determine it using these signals in order:
    1. If the page description explicitly mentions a company name — use that (e.g. description says "myHR Partner provides..." → name is "myHR Partner")
    2. If the scraped site name looks like a real company name (not generic like "Home", "Welcome", "Untitled") — use it
    3. Otherwise derive from the website domain: split compound words and capitalise properly (e.g. "71lbs" → "71lbs", "myhrpartner" → "myHR Partner", "redcloveradvisors" → "Red Clover Advisors", "tracebrandbuilding" → "Trace Brand Building")
    NEVER use the contact person's name as the company name.

- "tagline": A SHORT punchy phrase (max 8 words) capturing what the business DOES. No full stops. Examples: "Practical AI for business", "Fractional HR for growing teams".

- "description": 2-3 sentences in third person describing services and value. Max 250 characters. Only use what's in the data — do not invent facts.

- "tags": 5-10 keyword tags describing SERVICES, INDUSTRY, or EXPERTISE (max 4 words each). Examples: "HR Outsourcing", "AI Consulting", "Legal Services". NEVER use person names, website meta words, or the company name itself as tags.

Website details:
${context}`,
    })

    const parsed = TagsSchema.safeParse(result.output)
    if (!parsed.success) return null
    return parsed.data
  } catch (err) {
    console.error('[generate-business-tags] AI call failed:', err)
    return null
  }
}
