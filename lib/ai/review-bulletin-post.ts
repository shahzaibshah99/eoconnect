import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

export interface BulletinReviewResult {
  /** Null = post looks good, member can proceed without changes. */
  feedback: string | null
  /** 3-8 keyword tags extracted from content. Used for business matching. */
  tags: string[]
  /** True if the post has enough detail for effective matching. */
  is_complete: boolean
}

const ReviewSchema = z.object({
  feedback: z
    .string()
    .nullable()
    .describe('One short, specific suggestion to improve the post (max 100 chars). Null if post is already clear.'),
  tags: z
    .array(z.string())
    .describe('3-8 lowercase kebab-case keyword tags describing what is being requested.'),
  is_complete: z
    .boolean()
    .describe('True if the post has a clear requirement, specific enough geography, and a rough scope.'),
})

/**
 * AI review of a bulletin post before submission.
 *
 * Per scope F04: "AI prompts for missing specifics. If complete,
 * restructures for keyword clarity and extracts tags."
 *
 * Called from the server action when the member clicks "Next →" in
 * the post wizard. Returns in ≤8s; falls back gracefully on timeout.
 *
 * Tags are used downstream by the matching engine to find businesses
 * whose services.tags[] overlaps.
 */
export async function reviewBulletinPost(input: {
  title: string
  detail: string
  category: string
  geography: string
  required_by: string
}): Promise<BulletinReviewResult> {
  const FALLBACK: BulletinReviewResult = { feedback: null, tags: [], is_complete: true }

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[bulletin-review] OPENAI_API_KEY not set — skipping AI review')
    return FALLBACK
  }

  try {
    const result = await Promise.race([
      generateText({
        model: openai('gpt-4o-mini'),
        output: Output.object({ schema: ReviewSchema }),
        prompt: `You review business need posts for a member marketplace (EO/YPO entrepreneurs).

Post:
- Title: ${input.title}
- Category: ${input.category}
- Location: ${input.geography || 'not specified'}
- Required by: ${input.required_by}
- Detail: ${input.detail || '(none provided)'}

Your tasks:
1. Extract 3-8 specific keyword tags (lowercase kebab-case) that capture what is being requested.
   Good: ["legal-services", "startup", "ip-protection", "sydney"]
   Bad: ["help", "business", "need"]
   Include the geography as a tag if provided.

2. Decide if the post is specific enough:
   - Does it have a clear requirement? (not just "I need help with marketing")
   - Is the geography specific enough for matching? (country at minimum)
   - Is there any scope, budget, or timeline context?

3. If NOT specific enough, write ONE short concrete suggestion (max 100 chars):
   "Add a rough budget range?" or "Which city in Australia?" or "What type of legal support?"
   If specific enough, return null for feedback.

Be concise. Business owners need enough context to know if their service matches.`,
      }).then(r => r.output),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI review timeout')), 8000)
      ),
    ])

    return result ?? FALLBACK
  } catch (err) {
    console.error('[bulletin-review] AI review failed:', err)
    return FALLBACK
  }
}
