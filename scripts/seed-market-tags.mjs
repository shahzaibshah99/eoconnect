// Loads the taxonomy CSV into the market_tags table.
// Run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-market-tags.mjs <path-to-csv>
//
// Idempotent: uses ON CONFLICT (tag_id) DO UPDATE so re-runs are safe.
// Does NOT generate embeddings — run POST /api/admin/backfill-tag-embeddings after.

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [, , csvPath] = process.argv

if (!csvPath) {
  console.error('Usage: node scripts/seed-market-tags.mjs <path-to-csv>')
  process.exit(1)
}

if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('Error: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL must be set')
  process.exit(1)
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const db = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ── CSV parser ────────────────────────────────────────────────

function parseCsv(content) {
  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0])
  const rows = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    if (values.length === 0) continue
    const row = {}
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? '').trim()
    })
    rows.push(row)
  }

  return rows
}

function parseCsvLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

// ── Transform CSV row → DB row ────────────────────────────────

// CSV level column is a string like "specialism", "sub_niche", etc.
// Map to the smallint the DB expects.
const LEVEL_NAME_TO_INT = {
  sector:       1,
  industry:     2,
  niche:        3,
  sub_niche:    4,
  'sub-niche':  4,
  specialism:   5,
}

const LEVEL_INT_TO_WEIGHT_COL = {
  1: 'match_weight_sector',
  2: 'match_weight_industry',
  3: 'match_weight_niche',
  4: 'match_weight_sub_niche',
  5: 'match_weight_specialism',
}

const LEVEL_DEFAULT_WEIGHT = { 1: 0.20, 2: 0.40, 3: 0.60, 4: 0.80, 5: 1.00 }

function toDbRow(row) {
  const tagId = row['tag_id']
  if (!tagId) return null

  // Resolve level — accept either a numeric string ("5") or a name ("specialism")
  const rawLevel = (row['level'] ?? '').trim().toLowerCase()
  let level = parseInt(rawLevel, 10)
  if (isNaN(level)) level = LEVEL_NAME_TO_INT[rawLevel] ?? 0
  if (level < 1 || level > 5) return null

  // Pick the weight from the column that matches this row's level
  const weightCol = LEVEL_INT_TO_WEIGHT_COL[level]
  const matchWeight = parseFloat(row[weightCol] ?? '') || LEVEL_DEFAULT_WEIGHT[level]

  return {
    tag_id:       tagId,
    sector:       row['sector']     || '',
    industry:     row['industry']   || '',
    niche:        row['niche']      || '',
    sub_niche:    row['sub_niche']  || null,
    specialism:   row['specialism'] || null,
    tag_type:     row['tag_type']   || null,
    level,
    full_path:    row['full_path']  || '',
    match_weight: matchWeight,
    notes:        row['notes']      || null,
  }
}

// ── Main ──────────────────────────────────────────────────────

const csvContent = fs.readFileSync(csvPath, 'utf8')
const rawRows = parseCsv(csvContent)
console.log(`Parsed ${rawRows.length} rows from CSV`)

const dbRows = rawRows.map(toDbRow).filter(Boolean)
console.log(`Valid rows to upsert: ${dbRows.length}`)

const BATCH_SIZE = 500
let processed = 0
let errors = 0

for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
  const batch = dbRows.slice(i, i + BATCH_SIZE)

  const { error } = await db
    .from('market_tags')
    .upsert(batch, { onConflict: 'tag_id', ignoreDuplicates: false })

  if (error) {
    console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message)
    errors++
  } else {
    processed += batch.length
    process.stdout.write(`\rUpserted ${processed}/${dbRows.length}...`)
  }
}

console.log(`\nDone. ${processed} rows upserted, ${errors} batch errors.`)
if (errors > 0) {
  console.log('Some batches failed — check errors above and re-run to retry.')
  process.exit(1)
}
console.log('\nNext step: run POST /api/admin/backfill-tag-embeddings to generate embeddings.')
