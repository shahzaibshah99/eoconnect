-- ============================================================
-- 013_unique_service_title_per_business.sql
-- Stop duplicate services with the same title under a single
-- business listing.
--
-- Reported by Mirza (Dev TL) — Manage Services / NexaBuild Studio
-- happily accepted two "Full Project Management" rows with
-- identical price ranges. The app-level guard in createService
-- now pre-checks, but a partial unique index is the real backstop
-- so a race between two concurrent inserts can't punch through.
--
-- Comparison is case-insensitive and trims whitespace via lower(btrim(...)),
-- so "Full Project Management" and "  full project management  " collide.
--
-- Index is partial on services that aren't soft-deleted. We don't
-- currently soft-delete, but if a future migration adds a deleted_at
-- column, restoring this index to filter those out keeps the constraint
-- meaningful without blocking re-creation after a deletion-then-recreate
-- flow.
-- ============================================================

create unique index if not exists services_unique_title_per_business
  on public.services (business_id, lower(btrim(title)));
