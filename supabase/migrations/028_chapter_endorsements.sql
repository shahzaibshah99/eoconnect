-- ============================================================
-- 028_chapter_endorsements.sql
-- Chapter Manager endorsement signal for the verification queue.
--
-- Per scope F01: "Chapter Manager endorsement — Chapter Manager can
-- flag a new member as 'I can confirm this person is in our chapter.'
-- Additional signal in admin queue."
--
-- Distinct from the F07 "I've worked with" endorsement (business →
-- business trust) — this is identity confirmation only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chapter_endorsements (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chapter_id bigint NOT NULL REFERENCES public.eo_chapters(id) ON DELETE CASCADE,
  endorsed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note text,
  tenant_id text NOT NULL DEFAULT 'eo',
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One CM can only endorse one member for one chapter once. They can
  -- update the note via UPSERT, but no duplicate rows.
  UNIQUE(member_id, chapter_id, endorsed_by)
);

ALTER TABLE public.chapter_endorsements ENABLE ROW LEVEL SECURITY;

-- Admins read everything for the verification queue join.
CREATE POLICY "Admins read all chapter endorsements"
  ON public.chapter_endorsements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('chapter_admin', 'super_admin')
    )
  );

-- Chapter managers read endorsements for chapters they manage.
CREATE POLICY "CMs read endorsements for their chapter"
  ON public.chapter_endorsements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chapter_managers
      WHERE chapter_managers.chapter_id = chapter_endorsements.chapter_id
      AND chapter_managers.member_id = auth.uid()
    )
  );

-- Members read endorsements written about them — useful so the
-- verification page can show "your CM has confirmed you" for context.
CREATE POLICY "Members read own endorsements"
  ON public.chapter_endorsements FOR SELECT
  USING (auth.uid() = member_id);

-- Only CMs of the target chapter can write. Server actions go via
-- service-role for safety, but the policy makes direct writes from
-- the CM's session safe too.
CREATE POLICY "CMs write endorsements for their chapter"
  ON public.chapter_endorsements FOR ALL
  USING (
    auth.uid() = endorsed_by
    AND EXISTS (
      SELECT 1 FROM public.chapter_managers
      WHERE chapter_managers.chapter_id = chapter_endorsements.chapter_id
      AND chapter_managers.member_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS chapter_endorsements_member_idx
  ON public.chapter_endorsements (member_id);

CREATE INDEX IF NOT EXISTS chapter_endorsements_chapter_idx
  ON public.chapter_endorsements (chapter_id);

CREATE INDEX IF NOT EXISTS chapter_endorsements_tenant_idx
  ON public.chapter_endorsements (tenant_id);
