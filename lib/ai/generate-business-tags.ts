import 'server-only'
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const TagsSchema = z.object({
  tags: z.array(z.string().max(40)).max(10),
  description: z.string().max(2000),
})

export interface GeneratedBusinessData {
  tags: string[]
  description: string
}

/**
 * Use GPT-5 Nano (same model as the rest of the AI layer) to generate
 * search tags and a polished description for a pre-populated business
 * listing. Called after website + LinkedIn scraping so the model has
 * the richest possible context.
 */
export async function generateBusinessTags(input: {
  name: string
  rawDescription: string | null
  industry: string | null
  specialties: string[]
  website: string | null
}): Promise<GeneratedBusinessData | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[generate-business-tags] OPENAI_API_KEY not set — skipping')
    return null
  }

  const context = [
    `Business name: ${input.name}`,
    input.industry ? `Industry: ${input.industry}` : null,
    input.rawDescription ? `Description: ${input.rawDescription}` : null,
    input.specialties.length > 0 ? `Specialties: ${input.specialties.join(', ')}` : null,
    input.website ? `Website: ${input.website}` : null,
  ].filter(Boolean).join('\n')

  try {
    const result = await generateText({
      model: openai('gpt-5-nano'),
      output: Output.object({ schema: TagsSchema }),
      prompt: `You generate business listing data for a B2B marketplace for EO (Entrepreneurs' Organization) members.

Given the business details below, return:
- "tags": array of 5-10 short keyword tags (max 4 words each) that best describe what this business does. Think services, industries, expertise. Examples: "AI Consulting", "Legal Services", "Financial Planning", "Web Development"
- "description": a clean, professional 2-3 sentence description written in third person. Max 300 characters. Only use provided info — do not invent facts.

Business details:
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
