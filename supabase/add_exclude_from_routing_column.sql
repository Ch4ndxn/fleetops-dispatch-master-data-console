-- Migration: add exclude_from_routing column to technicians table
-- Run once in the Supabase SQL Editor (safe to re-run — uses IF NOT EXISTS)

ALTER TABLE technicians
  ADD COLUMN IF NOT EXISTS exclude_from_routing BOOLEAN NOT NULL DEFAULT FALSE;

-- Optional: update any existing rows explicitly (already defaults to FALSE)
-- UPDATE technicians SET exclude_from_routing = FALSE WHERE exclude_from_routing IS NULL;
