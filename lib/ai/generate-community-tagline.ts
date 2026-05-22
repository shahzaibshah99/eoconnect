import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

/**
 * Generates a one-line tagline for a community ask post.
 * Displayed under the title in the Needs & Asks feed to entice clicks.
 * Best-effort — returns null on failure or missing key.
 */
export async function generateCommunityTagline(input: {
  title: string
  detail: string
  category: string
}): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null

  try {
    const { text } = await generateText({
      model: openai('gpt-5-nano'),
      prompt: `Write a single-sentence tagline (max 100 characters) for this community ask from an EO/YPO entrepreneur network. Make it human, specific, and action-oriented — something that makes other members want to help.

Title: ${input.title}
Category: ${input.category}
Detail: ${input.detail || '(none)'}

Rules: one sentence only, no quotes, no trailing punctuation needed, no explanation.`,
    })
    const tagline = text.trim().replace(/^["']|["']$/g, '').slice(0, 120)
    return tagline || null
  } catch {
    return null
  }
}
