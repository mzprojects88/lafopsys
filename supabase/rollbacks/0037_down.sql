-- Reverses 0037. Any holiday, rate table or leave type HR added or edited
-- since is lost; re-apply re-seeds the 2026 list and the 2025/2026 tables.

drop table if exists hr.leave_types;
drop table if exists hr.rate_tables;
drop table if exists hr.holidays;
