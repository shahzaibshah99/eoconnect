import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

export interface BulletinReviewResult {
  /** Short, specific title AI generated from the description. */
  suggested_title: string
  /** 3-8 keyword tags extracted from content. Used for business matching. */
  tags: string[]
  /** True if the post has enough detail for effective matching. */
  is_complete: boolean
  /** Null = post looks good, member can proceed without changes. */
  feedback: string | null
}

const ReviewSchema = z.object({
  suggested_title: z
    .string()
    .describe(
      'A clear, specific title summarising the need (max 80 chars). ' +
      'Good: "IP lawyer needed for trademark filing in Sydney". ' +
      'Bad: "Need legal help" or "Looking for support".'
    ),
  tags: z
    .array(z.string())
    .describe(
      '3-8 lowercase kebab-case keyword tags that capture what is being requested. ' +
      'Good: ["legal-services", "ip-protection", "trademark", "startup", "sydney"]. ' +
      'Bad: ["help", "business", "need"]. Include geography as a tag if provided.'
    ),
  is_complete: z
    .boolean()
    .describe('True if the description has a clear requirement, specific enough geography, and some scope context.'),
  feedback: z
    .string()
    .nullable()
    .describe('One short, specific suggestion to improve the post (max 100 chars). Null if already clear and specific.'),
})

/**
 * AI review of a bulletin post before submission.
 *
 * Per scope F04/F05: user writes a free-form description; AI generates
 * a concise title, extracts matching tags, and flags if more detail
 * is needed. Called when the member clicks "Next → AI review".
 *
 * Returns in ≤8s; falls back gracefully on timeout or missing key.
 */
export async function reviewBulletinPost(input: {
  detail: string
  geography: string
  required_by: string
}): Promise<BulletinReviewResult> {
  const FALLBACK: BulletinReviewResult = {
    suggested_title: '',
    tags: [],
    is_complete: true,
    feedback: null,
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[bulletin-review] OPENAI_API_KEY not set — skipping AI review')
    return FALLBACK
  }

  try {
    const result = await Promise.race([
      generateText({
        model: openai('gpt-4o-mini'),
        output: Output.object({ schema: ReviewSchema }),
        prompt: `You review posts for a peer-to-peer member marketplace used by EO and YPO entrepreneurs.

The member has described what they need:
---
${input.detail || '(no description provided)'}
---
Location: ${input.geography || 'not specified'}
Needed by: ${input.required_by}

Your tasks:
1. Write a clear, specific title (max 80 chars) capturing the core need.
2. Extract 3-8 lowercase kebab-case keyword tags for matching. Include geography.
3. Decide if the description is specific enough: clear requirement, specific geography, some scope/budget/timeline context.
4. If NOT specific enough, one concrete suggestion (max 100 chars). Null if fine.

Be concise — business owners need enough context to judge if they're a fit.`,
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
