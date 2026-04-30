/**
 * Normalize a website URL for duplicate-detection.
 *
 * Mirrors the logic in migration 016's generated column
 * `businesses.website_normalized`. Keep these two in sync — the app
 * pre-checks here for a friendly error, and the DB unique index uses
 * the same normalization as a backstop against races.
 *
 * Rules:
 *   - lowercase
 *   - strip leading http:// or https://
 *   - strip leading www.
 *   - strip trailing slashes
 *   - trim surrounding whitespace
 *   - empty/whitespace-only input → null (no duplicate check fires)
 *
 * Paths are preserved on purpose. "company.com/widgets" and
 * "company.com/services" are two genuinely different listings if the
 * member runs two product lines.
 */
export function normalizeWebsite(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed === '') return null
  return trimmed
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}
