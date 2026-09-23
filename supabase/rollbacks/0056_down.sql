-- Undo 0056: drops the English column (the Filipino rules stay).
alter table ops.orientation_topics drop column if exists topic_en;
notify pgrst, 'reload schema';
