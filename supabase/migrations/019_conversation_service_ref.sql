-- ============================================================
-- 019_conversation_service_ref.sql
-- Track which service an inquiry is about, structurally.
--
-- Background:
--   - sendInquiry has always prepended "Re: <service title>" to the
--     first message body when a service was selected. That preserved
--     the context inside the chat but left the conversation row
--     itself with no structured reference.
--   - Mirza + Irfan + Shahzaib agreed the inbox UX should surface
--     the service alongside the business and member context. Parsing
--     the "Re:" prefix back out of the body is fragile (members
--     edit prefixes, the body could be empty when an attachment was
--     sent without text, prefixes can be in any language, etc.).
--
-- This migration adds an optional service_id column to conversations.
-- New conversations created via sendInquiry will set it. Existing
-- conversations are left with NULL — the UI shows no service line in
-- that case. We don't try to backfill from the message body.
--
-- ON DELETE SET NULL so deleting a service doesn't cascade-delete
-- the conversation. The chat history outlives the listing it was
-- originally about (same pattern conversations.listing_id uses
-- against businesses).
-- ============================================================

alter table public.conversations
  add column if not exists service_id uuid
    references public.services(id) on delete set null;

-- Optional read-side index. Most conversation lookups today are by
-- participant_ids or listing_id; service_id is mostly used for
-- display joins, not filtering. Keep the index small with a partial
-- predicate so write traffic on conversations isn't penalised by an
-- index over many NULL rows.
create index if not exists conversations_service_id_idx
  on public.conversations (service_id)
  where service_id is not null;
