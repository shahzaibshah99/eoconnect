import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

export interface ExtractedReferral {
  referred_name: string
  referred_category: string
  referred_location: string
  full_text: string
}

const ExtractedReferralSchema = z.object({
  referrals: z.array(z.object({
    referred_name: z.string().describe('Name of the person or business being recommended'),
    referred_category: z.string().describe('What they do / their service area (e.g. "IP lawyer", "integrative medicine", "web developer")'),
    referred_location: z.string().describe('City or country if mentioned, empty string if not'),
    full_text: z.string().describe('The sentence(s) that contain the referral — verbatim from the reply'),
  })).describe('List of referrals found. Empty array if none.'),
})

/**
 * Silently extract referrals from a bulletin board reply using GPT-4o-mini.
 *
 * Per scope F18: "When a member writes 'Bastian is a great doctor in Bali'
 * in any reply thread, the system automatically extracts and stores this as
 * a tagged referral — no prompt, no opt-in."
 *
 * A "referral" is an explicit recommendation of a named person or business
 * for a specific service or skill. Vague mentions ("someone mentioned legal")
 * are NOT referrals and should not be extracted.
 *
 * Returns [] on timeout, missing API key, or no referrals found.
 * Caller is responsible for storing and embedding the results.
 */
export async function extractReferralsFromReply(
  replyText: string
): Promise<ExtractedReferral[]> {
  if (!process.env.OPENAI_API_KEY) return []
  if (!replyText?.trim()) return []

  try {
    const result = await Promise.race([
      generateText({
        model: openai('gpt-4o-mini'),
        output: Output.object({ schema: ExtractedReferralSchema }),
        prompt: `You extract referrals from member-to-member replies in a business network.

Reply text:
"""
${replyText.slice(0, 2000)}
"""

A referral is when someone explicitly recommends a NAMED person or business for a specific service or skill.

Examples of referrals:
- "You should reach out to Sarah Chen at Nexus Legal — she specialises in IP for startups in Singapore"
- "Bastian is an excellent integrative doctor in Bali, he helped my team"
- "I used James from Harbour Digital for our rebrand, highly recommend for branding in Sydney"

Examples that are NOT referrals (skip these):
- "There are lots of lawyers in Sydney" (no name)
- "Marketing is hard" (no recommendation)
- "I agree with what you said" (no referral)
- "My company does this" (self-promotion, not a referral)

For each referral found:
- referred_name: the specific name (person or business)
- referred_category: what they do (be specific — "IP lawyer" not just "lawyer")
- referred_location: city/country if mentioned, otherwise ""
- full_text: the exact sentence(s) containing the referral

Be conservative. Only extract explicit named recommendations. Return empty array if none.`,
      }).then(r => r.output),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('extraction timeout')), 10000)
      ),
    ])

    return result?.referrals ?? []
  } catch (err) {
    console.error('[referral-extract] failed:', err instanceof Error ? err.message : err)
    return []
  }
}
