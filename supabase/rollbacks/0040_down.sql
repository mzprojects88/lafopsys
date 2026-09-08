-- Reverses 0040: every leave request and adjustment is lost.

drop table if exists hr.leave_adjustments;
drop table if exists hr.leave_requests;
drop function if exists hr.guard_own_leave_request_update();
