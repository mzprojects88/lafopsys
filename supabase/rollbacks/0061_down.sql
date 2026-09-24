-- Undo 0061. Days reported as forgotten keep flag = missed_punch.
drop function if exists ops.report_missed_clock_out(uuid, timestamptz, text);
alter publication supabase_realtime drop table ops.dtr_correction_requests;
drop table if exists ops.dtr_correction_requests;
notify pgrst, 'reload schema';
