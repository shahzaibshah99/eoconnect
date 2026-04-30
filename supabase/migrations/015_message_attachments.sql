-- ============================================================
-- 015_message_attachments.sql
-- Add attachment metadata to messages so chat can carry images
-- and small files alongside text.
--
-- Storage strategy: files live in the existing eoconnect-media
-- bucket under chat/<conversation_id>/<random>-<filename>. The
-- DB row stores the public URL, the original filename, MIME type,
-- and size in bytes. Caps:
--   - 12 MB per file (enforced both client- and server-side)
--   - One attachment per message (multi-attachment is YAGNI for now)
--
-- The body column stays NOT NULL — messages with only an attachment
-- carry an empty string. This is simpler than making body nullable
-- and updating every read site to handle null. The send action
-- requires either non-empty body OR a non-null attachment_url.
-- ============================================================

alter table public.messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size integer
    check (attachment_size is null or (attachment_size > 0 and attachment_size <= 12 * 1024 * 1024));

-- Allow body to be empty (still NOT NULL, just possibly '') when an
-- attachment exists. The application enforces "at least one of body or
-- attachment is non-empty"; we don't add a CHECK constraint here so
-- a future migration adding richer message types (e.g. system messages
-- with empty body and no attachment) doesn't have to drop a constraint.
