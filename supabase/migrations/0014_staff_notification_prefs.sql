-- Phase 5: per-staff notification preference storage. Backs
-- /settings/notifications, which previously only showed a toast with no
-- persistence at all (state reset to the hardcoded defaults on every reload).
--
-- Delivery itself (email digest, SMS) is not built here -- no email/SMS
-- provider is wired into this app. This migration only makes the on/off
-- preference real and durable per staff member; the settings page states
-- the delivery boundary explicitly rather than implying it's fully wired.

alter table shared.staff add column notification_prefs jsonb not null default '{}'::jsonb;
