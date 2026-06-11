// Throwaway debug — reads WhatsApp tables via service-role key.
// Run: node --env-file=.env.local scripts/wa-debug-check.mjs
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const log = await db.from('whatsapp_classification_log').select('waha_message_id,intent,confidence,dropped,post_id,created_at').order('created_at', { ascending: false }).limit(5)
console.log('\n=== classification_log (latest 5) ===')
console.log(log.error ? `ERR: ${log.error.message}` : (log.data.length ? log.data : '(empty)'))

const su = await db.from('shadow_users').select('id,whatsapp_jid,whatsapp_display_name,source_group_jid,linked_user_id,created_at').order('created_at', { ascending: false }).limit(5)
console.log('\n=== shadow_users (latest 5) ===')
console.log(su.error ? `ERR: ${su.error.message}` : (su.data.length ? su.data : '(empty)'))

const bp = await db.from('bulletin_posts').select('id,title,category,source,geography_country,status').eq('source', 'whatsapp').order('created_at', { ascending: false }).limit(5)
console.log('\n=== bulletin_posts (source=whatsapp, latest 5) ===')
console.log(bp.error ? `ERR: ${bp.error.message}` : (bp.data.length ? bp.data : '(empty)'))

const dm = await db.from('whatsapp_dm_state').select('jid,state,last_post_id,updated_at').order('updated_at', { ascending: false }).limit(5)
console.log('\n=== whatsapp_dm_state (latest 5) ===')
console.log(dm.error ? `ERR: ${dm.error.message}` : (dm.data.length ? dm.data : '(empty)'))
console.log('')
process.exit(0)
