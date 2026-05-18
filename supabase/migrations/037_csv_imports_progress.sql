-- Track how many rows have been processed so far during batch import.
-- Allows the UI to show a real percentage progress bar and resume
-- processing from where it left off if the browser tab is closed.

ALTER TABLE public.csv_imports
  ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0;
