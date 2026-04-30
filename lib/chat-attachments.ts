import { createClient } from '@/lib/supabase/client'

export const CHAT_ATTACHMENT_MAX_BYTES = 12 * 1024 * 1024 // 12 MB
export const CHAT_ATTACHMENT_BUCKET = 'eoconnect-media'

/**
 * Allowed MIME types for chat attachments.
 *
 * Limited to images (preview inline) and a small set of office/document
 * types members are likely to share. Executable types (binaries, scripts,
 * archives) are deliberately excluded — chat is not a file-sharing service
 * and we don't want to host arbitrary downloads inside the marketplace.
 */
export const CHAT_ALLOWED_MIME_PREFIXES = [
  'image/',
] as const

export const CHAT_ALLOWED_MIME_EXACT = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
])

export function isChatAttachmentMimeAllowed(mime: string): boolean {
  if (CHAT_ALLOWED_MIME_PREFIXES.some(p => mime.startsWith(p))) return true
  return CHAT_ALLOWED_MIME_EXACT.has(mime)
}

export function formatChatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface ChatAttachmentValidationError {
  reason: 'too_large' | 'bad_type'
  message: string
}

export function validateChatAttachment(file: File): ChatAttachmentValidationError | null {
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    return {
      reason: 'too_large',
      message: `File is ${formatChatAttachmentSize(file.size)} — max is ${formatChatAttachmentSize(CHAT_ATTACHMENT_MAX_BYTES)}.`,
    }
  }
  if (!isChatAttachmentMimeAllowed(file.type)) {
    return {
      reason: 'bad_type',
      message: 'This file type is not allowed in chat. Try an image, PDF, or Office document.',
    }
  }
  return null
}

export interface UploadedChatAttachment {
  url: string
  name: string
  mime: string
  size: number
}

/**
 * Uploads a single attachment to the eoconnect-media bucket under
 * chat/<conversationId>/<timestamp>-<safeFileName> and returns the
 * public URL plus original metadata.
 *
 * Conversation-scoped path means RLS-style cleanup on conversation
 * deletion is straightforward (delete the prefix). Filename is
 * sanitized — keeping the original visible name lets recipients see
 * what they're downloading; the prefix prevents collisions.
 */
export async function uploadChatAttachment(
  conversationId: string,
  file: File,
): Promise<UploadedChatAttachment> {
  const validation = validateChatAttachment(file)
  if (validation) throw new Error(validation.message)

  const supabase = createClient()
  const safeName = file.name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .slice(0, 80) || 'file'
  const path = `chat/${conversationId}/${Date.now()}-${safeName}`

  const { error: uploadErr } = await supabase.storage
    .from(CHAT_ATTACHMENT_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

  const { data } = supabase.storage.from(CHAT_ATTACHMENT_BUCKET).getPublicUrl(path)
  return {
    url: data.publicUrl,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  }
}
