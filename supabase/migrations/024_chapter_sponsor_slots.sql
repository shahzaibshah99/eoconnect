-- ============================================================
-- 024_chapter_sponsor_slots.sql
-- Adds sponsor slot allocation to eo_chapters for the Chapter
-- Management admin panel (F15 + F13 sponsor tier).
--
-- Per scope doc: app admin sets the sponsor slot count per chapter,
-- chapter manager activates sponsors within that allocation. Default
-- 0 means "no sponsors permitted yet" — admin opts each chapter in.
-- ============================================================

ALTER TABLE public.eo_chapters
  ADD COLUMN IF NOT EXISTS sponsor_slots integer NOT NULL DEFAULT 0
    CHECK (sponsor_slots >= 0 AND sponsor_slots <= 50);

CREATE INDEX IF NOT EXISTS eo_chapters_sponsor_slots_idx
  ON public.eo_chapters (sponsor_slots)
  WHERE sponsor_slots > 0;
