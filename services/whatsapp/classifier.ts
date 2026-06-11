import 'server-only'
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { SENSITIVE_MARKERS } from './sensitive-markers'

export type ClassificationIntent = 'need' | 'lead' | 'noise'

export interface ClassificationResult {
  intent: ClassificationIntent
  confidence: number
  sensitive: boolean
  extracted?: {
    title: string
    detail: string
    tags: string[]
    category: string
    country: string
    city: string
    required_by: string
  }
}

const ClassificationSchema = z.object({
  intent: z
    .enum(['need', 'lead', 'noise'])
    .describe(
      'need = member is explicitly seeking a service/supplier/resource/recommendation. ' +
      'lead = member is offering services, referrals, or has something to provide. ' +
      'noise = social chat, celebrations, irrelevant discussion, spam, or anything not a clear business need or lead.'
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence in the classification, 0.0 to 1.0.'),
  extracted: z
    .object({
      title: z.string().describe('Clear, specific title (10-120 chars). Good: "CFO needed for Series A startup in Sydney". Bad: "Need help".'),
      detail: z.string().describe('Clean summary of what is needed/offered (max 500 chars).'),
      tags: z.array(z.string()).describe('3-8 keyword tags for business matching, e.g. ["CFO", "Finance", "Sydney"].'),
      category: z.string().describe('Single primary category, e.g. "Finance", "Legal", "Technology", "Marketing".'),
      country: z.string().describe('Country name if mentioned, otherwise empty string.'),
      city: z.string().describe('City name if mentioned, otherwise empty string.'),
      required_by: z.string().describe('Date in YYYY-MM-DD format. Use a near-term date if urgency is implied.'),
    })
    .nullable()
    .describe('Extracted structured data. REQUIRED when intent is "need" or "lead". Null when intent is "noise".'),
})

export async function classifyMessage(messageText: string): Promise<ClassificationResult> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[classifier] OPENAI_API_KEY not set — skipping classification')
    return { intent: 'noise', confidence: 0, sensitive: false }
  }

  const trimmed = messageText.trim()
  if (!trimmed || trimmed.length < 10) {
    return { intent: 'noise', confidence: 1, sensitive: false }
  }

  // Pre-screen for sensitive markers before calling the LLM (saves tokens)
  const lowerText = trimmed.toLowerCase()
  if (SENSITIVE_MARKERS.some(marker => lowerText.includes(marker))) {
    return { intent: 'noise', confidence: 0, sensitive: true }
  }

  const today = new Date().toISOString().split('T')[0]
  const defaultRequiredBy = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  try {
    const result = await generateText({
      model: openai('gpt-5-nano'),
      output: Output.object({ schema: ClassificationSchema }),
      // gpt-5-nano with structured output can take ~10-15s. Cap it so the
      // webhook can't hang indefinitely on a slow/stuck LLM call.
      abortSignal: AbortSignal.timeout(30_000),
      prompt: `You classify WhatsApp messages from an EO (Entrepreneurs' Organization) members-only group.

Your job: determine if a message is a business need or lead that should be posted to a member marketplace.

Message:
---
${trimmed.slice(0, 2000)}
---

Classifications:
- "need": Member is explicitly seeking a service, supplier, resource, or recommendation (e.g. "Looking for a CFO in Sydney", "Need a graphic designer for rebrand")
- "lead": Member is offering services, referrals, or has something to provide (e.g. "I know a great lawyer in Cape Town", "Our firm does X if anyone needs it")
- "noise": Social chat, celebrations, irrelevant discussion, spam, or anything that is not a clear business need or lead

When intent is "need" or "lead", populate "extracted". When intent is "noise", set "extracted" to null.

For required_by, default to ${defaultRequiredBy} if no urgency is implied. Today is ${today}.

Be conservative: if you are unsure whether something is a genuine business need/lead, classify it as "noise" with low confidence.`,
    })

    const output = result.output
    if (!output) {
      return { intent: 'noise', confidence: 0, sensitive: false }
    }

    // Treat low-confidence results as noise (log for telemetry, don't post)
    const intent: ClassificationIntent = output.confidence < 0.70 ? 'noise' : output.intent

    // Validate / default required_by
    const extracted = output.extracted ?? undefined
    if (extracted?.required_by && !/^\d{4}-\d{2}-\d{2}$/.test(extracted.required_by)) {
      extracted.required_by = defaultRequiredBy
    }

    return {
      intent,
      confidence: output.confidence,
      sensitive: false,
      extracted: intent === 'noise' ? undefined : extracted,
    }
  } catch (err) {
    console.error('[classifier] classification failed:', err)
    // Re-throw so the webhook handler logs it as a classification error
    throw err
  }
}
