-- Enables Supabase Realtime on the DTR tables so clock-status UI (topbar
-- badge, /staff roster, clock-in gate) can update from a postgres_changes
-- subscription instead of only on mount/refetch. Mirrors the sibling
-- laf-inventory app's own 0005_realtime_publication.sql precedent.

alter publication supabase_realtime add table
  ops.time_entries,
  ops.time_punches;
