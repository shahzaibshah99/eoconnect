'use server'

import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const Schema = z.object({
  tagline: z.string().max(120),
})

/**
 * Generate a short punchy tagline for a business based on its details.
 * Uses the same AI model as the rest of the platform (gpt-5-nano).
 * Called client-side from the business edit/create form.
 */
export async function generateTagline(input: {
  name: string
  description: string
  tags?: string
  website?: string
}): Promise<{ error: string | null; tagline?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  if (!process.env.OPENAI_API_KEY) {
    return { error: 'AI not configured' }
  }

  const context = [
    `Business name: ${input.name}`,
    input.description ? `Description: ${input.description}` : null,
    input.tags ? `Tags/services: ${input.tags}` : null,
    input.website ? `Website: ${input.website}` : null,
  ].filter(Boolean).join('\n')

  try {
    const result = await generateText({
      model: openai('gpt-5-nano'),
      output: Output.object({ schema: Schema }),
      prompt: `Generate a short, punchy tagline for this business.

Rules:
- Maximum 10 words
- No full stops at the end
- Should clearly describe what the business does or its value
- Professional but memorable
- Do NOT just repeat the business name
- Examples of good taglines: "Practical AI for business", "Women-only fitness across Australia", "Data-led asset management worldwide"

Business details:
${context}`,
    })

    const parsed = Schema.safeParse(result.output)
    if (!parsed.success) return { error: 'AI returned invalid response' }
    return { error: null, tagline: parsed.data.tagline }
  } catch {
    return { error: 'AI generation failed — try again' }
  }
}
